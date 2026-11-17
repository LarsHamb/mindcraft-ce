import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { logoutAgent } from '../mindcraft/mindserver.js';

const init_agent_path = fileURLToPath(new URL('./init_agent.js', import.meta.url));

export class AgentProcess {
    constructor(name, port, process_token) {
        this.name = name;
        this.port = port;
        this.process_token = process_token;
    }

    start(load_memory=false, init_message=null, count_id=0) {
        this.count_id = count_id;
        this.running = true;

        let args = [init_agent_path, this.name];
        args.push('-n', this.name);
        args.push('-c', count_id);
        if (load_memory)
            args.push('-l', load_memory);
        if (init_message)
            args.push('-m', init_message);
        args.push('-p', this.port);

        const agentEnv = { ...process.env, MINDCRAFT_AGENT_TOKEN: this.process_token };
        delete agentEnv.MINDCRAFT_CONTROL_TOKEN;
        const agentProcess = spawn(process.execPath, args, {
            stdio: 'inherit',
            stderr: 'inherit',
            env: agentEnv,
        });

        let last_restart = Date.now();
        agentProcess.on('exit', (code, signal) => {
            console.log(`Agent process exited with code ${code} and signal ${signal}`);
            this.running = false;
            logoutAgent(this.name);

            if (code > 1) {
                console.log(`Ending task`);
                process.exit(code);
            }

            if (code !== 0 && signal !== 'SIGINT') {
                // agent must run for at least 10 seconds before restarting
                if (Date.now() - last_restart < 10000) {
                    console.error(`Agent process exited too quickly and will not be restarted.`);
                    // Unattended server bot: leave the whole process after a pause, so Docker's restart policy
                    // brings it back (the pause avoids Mojang's 429 for logins in quick succession).
                    const waitSeconds = Number(process.env.EXIT_ON_AGENT_FAILURE);
                    if (Number.isFinite(waitSeconds) && waitSeconds >= 0) {
                        console.error(`Exiting in ${waitSeconds} s so the container restarts.`);
                        setTimeout(() => process.exit(1), waitSeconds * 1000);
                    }
                    return;
                }
                // Boys patch (17.11.): a failed login ("Failed to obtain profile data", Mojang 429) restarted at once,
                // again and again, which keeps the limit going. Quick deaths back off: 30 s, 60 s, ... up to 10 min.
                this.quickFails = Date.now() - last_restart < 120000 ? (this.quickFails || 0) + 1 : 0;
                const pause = this.quickFails ? Math.min(600, 30 * 2 ** (this.quickFails - 1)) : 0;
                console.log(pause ? `Restarting agent in ${pause} s (failed ${this.quickFails}x in a row)...` : 'Restarting agent...');
                setTimeout(() => {
                    this.start(true, 'Agent process restarted.', count_id, this.port);
                    last_restart = Date.now();
                }, pause * 1000);
            }
        });

        agentProcess.on('error', (err) => {
            console.error('Agent process error:', err);
        });

        this.process = agentProcess;
    }

    stop() {
        if (!this.running) return;
        this.process.kill('SIGINT');
    }

    forceRestart() {
        if (this.running && this.process && !this.process.killed) {
            console.log(`Agent process for ${this.name} is still running. Attempting to force restart.`);

            const restartTimeout = setTimeout(() => {
                console.warn(`Agent ${this.name} did not stop in time. It might be stuck.`);
            }, 5000); // 5 seconds to exit

            this.process.once('exit', () => {
                 clearTimeout(restartTimeout);
                 console.log(`Stopped hanging agent ${this.name}. Now restarting.`);
                 this.start(true, 'Agent process restarted.', this.count_id);
            });
            this.stop(); // sends SIGINT
        } else {
             this.start(true, 'Agent process restarted.', this.count_id);
        }
    }
}
