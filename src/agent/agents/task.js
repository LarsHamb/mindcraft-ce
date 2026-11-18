import { journal } from '../journal.js';
import { executeTool, getToolDefinitions, isToolAction } from '../commands/tool_registry.js';
import { toolCallMessage } from '../../models/_tool_request.js';
import settings from '../settings.js';
import { asToolResult, toolResult, toolResultText } from '../tool_result.js';
import { ToolNarrator } from '../narration.js';
import { parseObject, chatText, functionTool, validateArguments } from './structured.js';
import { playerNarration, problemMessage } from '../user_messages.js';
import { restoreBetweenTools, grabValuables } from '../modes.js';

// Boys test 17.11.: it called craftRecipe stick without planks 26 times in an hour. The same call that
// failed twice with the same inventory is not run a third time; the model gets a clear hint instead.
const REPEAT_WINDOW_MS = 10 * 60000;
// inventory plus rough position: a search may succeed again after moving 16 blocks
const inventoryKey = agent => {
    const p = agent.bot?.entity?.position;
    const where = p ? `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}` : '';
    return where + '|' + (agent.bot?.inventory?.items?.() || []).map(i => `${i.name}:${i.count}`).sort().join(',');
};
const callKey = call => `${call.name}:${JSON.stringify(call.arguments || {})}`;
export function noteFailure(agent, call, result, now = Date.now()) {
    const map = agent._failedCalls ??= new Map();
    const key = callKey(call);
    if (!['failed', 'blocked'].includes(result?.status)) { map.delete(key); return; }
    const inv = inventoryKey(agent), prev = map.get(key);
    const same = prev && prev.inv === inv && now - prev.at < REPEAT_WINDOW_MS;
    map.set(key, {n: same ? prev.n + 1 : 1, inv, at: now, text: String(result.text || '').slice(0, 160)});
    if (map.size > 50) map.delete(map.keys().next().value);
}
export function repeatedFailure(agent, call, now = Date.now()) {
    const prev = agent._failedCalls?.get(callKey(call));
    if (!prev || prev.n < 2 || now - prev.at > REPEAT_WINDOW_MS || prev.inv !== inventoryKey(agent)) return null;
    return toolResult('blocked', `NOT run again: this exact call already failed ${prev.n} times with the same inventory ("${prev.text}"). First get what is missing (collect, craft the ingredient, or go elsewhere), or choose a different step.`, 'repeated_failure');
}

const controls = [
    functionTool('taskDone','Declare the assigned objective complete, with factual evidence.',{summary:{type:'string'}},[]),
    functionTool('taskBlocked','Return control to the Brain with a specific blocker after reasonable recovery attempts.',{reason:{type:'string'}}),
    functionTool('requestTools','Request additional available tools for this directive.',{names:{type:'array',items:{type:'string'}},reason:{type:'string'}},['names']),
];

// The task loop resends its whole history with every request, so long directives grew to ~60k characters
// per request. Send only the objective plus the recent tail; older steps become one short note. The tail never
// starts with a tool result, so every tool result keeps the call it answers.
export const TASK_HISTORY_TAIL = 8;
// Older tool results (nearby blocks, entities, inventories) are long and stale; only the newest ones stay full.
export const FULL_RESULTS = 2, SHORT_RESULT = 300;
function shortenOldResults(messages) {
    const tools = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter(i => i >= 0);
    const keepFull = new Set(tools.slice(-FULL_RESULTS));
    return messages.map((m, i) => (m.role === 'tool' && !keepFull.has(i) && String(m.content || '').length > SHORT_RESULT
        ? {...m, content: `${String(m.content).slice(0, SHORT_RESULT)} ... (shortened)`} : m));
}
export function compactTaskHistory(history, lastResults = [], keep = TASK_HISTORY_TAIL) {
    if (history.length <= keep + 2) return shortenOldResults(history);
    const head = history.slice(0, 1);
    let start = history.length - keep;
    while (start < history.length && history[start]?.role === 'tool') start++;
    const omitted = start - 1;
    if (omitted <= 0) return shortenOldResults(history);
    const recent = lastResults.slice(-5).map(r => `${r.name}: ${r.status || ''} ${String(r.text || '').slice(0, 120)}`.trim()).join('; ');
    const note = {role: 'user', content: `(${omitted} earlier messages of this task omitted to save tokens. Recent results: ${recent || 'none'}. Check the fresh state before repeating work.)`};
    return shortenOldResults([...head, note, ...history.slice(start)]);
}

export class TaskAgent {
    constructor(agent, messageQueue) {
        this.agent=agent;this.messageQueue=messageQueue;this.is_running=false;this.cancelJob=false;
        this.currentTaskDescription=null;this.currentStep=0;this.allowedTools=null;this.lastResults=[];
    }
    async performTask(description, systemPrompt='', directive={}) {
        if(this.is_running) throw new Error('A task is already running');
        this.is_running=true;this.cancelJob=false;this.currentTaskDescription=description;this.currentStep=0;
        // Without a grant from Brain, send the usual actions only (settings.task_default_tools); requestTools adds more.
        // The full list was 70 % of every task request.
        const defaults=settings.task_default_tools;
        this.allowedTools=Array.isArray(directive.tools)?new Set(directive.tools):Array.isArray(defaults)&&defaults.length?new Set(defaults):null;
        this.directive=directive;
        try {
            this.model=this.agent.prompter.selectTaskModel?.(directive.model||this.agent.prompter.model_selection?.default_task_model)
                ||this.agent.prompter.task_model||this.agent.prompter.chat_model;
            const template=this.agent.prompter.profile.task_agent||'';
            const header=template?await this.agent.prompter.replaceStrings(template,[]):'';
            // The system prompt stays identical for every task, so Gemini's cache can reuse it; what changes
            // per task (objective, briefing, constraints) goes into the first message.
            const prompt=`${header}\nUse native tools. Call taskDone when the assigned objective is verified complete, or taskBlocked with a specific blocker.${this.allowedTools&&!Array.isArray(directive.tools)?' Only common actions are listed; call requestTools for others (e.g. placeBlockAt, digDown, useOn, discard).':''}`;
            const first=[`Objective: ${description}`,systemPrompt].filter(Boolean).join('\n');
            return await this.runLoop([{role:'user',content:first}],prompt,false);
        } finally {
            this.is_running=false;this.currentTaskDescription=null;this.currentStep=0;
        }
    }
    async runLoop(history,prompt=null,conversation=true,shouldInterrupt=()=>false,maxSteps=settings.agent_max_steps??50) {
        if(!Number.isSafeInteger(maxSteps)||maxSteps<1) throw new Error('agent_max_steps must be a positive integer');
        let usedTool=false,noTools=0;
        let executed=0;
        const callLimit=settings.agent_max_tool_calls??80;
        const batchLimit=settings.max_tool_calls_per_response??12;
        if(!Number.isSafeInteger(callLimit)||callLimit<1||!Number.isSafeInteger(batchLimit)||batchLimit<1) throw new Error('Tool call limits must be positive integers');
        const wasRunning=this.is_running;
        this.is_running=true;
        let narrator;
        try {
            narrator=new ToolNarrator(this.agent,this.source);
            this.narrator=narrator;
            this.requestRole=conversation?'conversation':'task';
            for(let step=1;step<=maxSteps;step++) {
                this.currentStep=step;
                for(const item of this.messageQueue?.drain()||[]) {
                    if(item.type==='cancel') this.cancelTask();
                    else history.push({role:'user',content:`[Update from ${item.source}]: ${item.message}`});
                }
                if(this.cancelJob||shouldInterrupt()) break;
                const available=getToolDefinitions(this.agent);
                const definitions=available.filter(t=>!this.allowedTools||this.allowedTools.has(t.function.name)||!isToolAction(this.agent,t.function.name));
                if(!conversation) definitions.push(...controls);
                narrator.startThinking();
                const [text,calls]=conversation
                    ?await this.agent.prompter.promptTools(history,definitions)
                    :await this.agent.prompter.requestTools(compactTaskHistory(history,this.lastResults),prompt,definitions,null,this.model||this.agent.prompter.task_model||this.agent.prompter.chat_model);
                narrator.endThinking();
                if(this.cancelJob||shouldInterrupt()) break;
                history.push(toolCallMessage(text,calls));
                const parsed=parseObject(text),visible=chatText(text);
                const recorded=[text,...calls.map(c=>`Tool call ${c.name}: ${JSON.stringify(c.arguments)}`)].filter(Boolean).join('\n');
                if(recorded) await this.agent.history?.add(this.agent.name,recorded);
                if(this.cancelJob||shouldInterrupt()) break;
                await narrator.assistant(visible,{hasCalls:calls.length>0,question:parsed?.input_from_user_needed===true});
                let handoff=null;
                let batchExecuted=0;
                for(const call of calls) {
                    if(this.cancelJob||shouldInterrupt()) break;
                    const control=!conversation&&controls.find(t=>t.function.name===call.name);
                    let result;
                    try {
                        if(executed>=callLimit||batchExecuted>=batchLimit) {
                            result=toolResult('blocked','This call was NOT executed because the tool-call budget was reached.','tool_budget');
                            history.push({role:'tool',name:call.name,tool_call_id:call.id,content:toolResultText(result)});
                            continue;
                        }
                        if(control) validateArguments(control,call.arguments);
                        executed++;batchExecuted++;
                        if(!conversation&&call.name==='taskDone') {
                            handoff={work_done:true,chat_response:call.arguments.summary||visible};
                            result=toolResult('ok','Task completion handed to Brain.');
                        } else if(!conversation&&call.name==='taskBlocked') {
                            if(typeof call.arguments.reason!=='string'||!call.arguments.reason.trim()) throw new Error('taskBlocked requires a reason');
                            handoff={work_done:false,chat_response:playerNarration(call.arguments.reason)||problemMessage(),blocked:true};
                            result=toolResult('blocked',call.arguments.reason);
                        } else if(!conversation&&call.name==='requestTools') {
                            if(!Array.isArray(call.arguments.names)||call.arguments.names.some(n=>typeof n!=='string')) throw new Error('requestTools needs a string array');
                            const allowed=new Set(available.map(t=>t.function.name));
                            const requested=call.arguments.names.filter(n=>allowed.has(n));
                            for(const name of requested) this.allowedTools?.add(name);
                            result=toolResult('ok',`Available: ${requested.join(', ')}. Unavailable: ${call.arguments.names.filter(n=>!allowed.has(n)).join(', ')||'none'}.`);
                        } else {
                            if(!definitions.some(t=>t.function.name===call.name)) throw new Error(`Tool ${call.name} is not granted; use requestTools`);
                            await narrator.beforeTool(call);
                            this.agent.self_prompter?.handleUserPromptedCmd(this.source==='system'||this.source===this.agent.name,isToolAction(this.agent,call.name));
                            const repeat=repeatedFailure(this.agent,call);
                            if(repeat) result=repeat;
                            else {
                                console.log(`[TaskAgent] Calling tool ${call.name}`,call.arguments);
                                result=asToolResult(await executeTool(this.agent,call.name,call.arguments));usedTool=true;
                                noteFailure(this.agent,call,result);
                            }
                        }
                    } catch(error) {result=toolResult('failed',error.message,error.code||'error');}
                    if(this.cancelJob||shouldInterrupt()) break;
                    const content=toolResultText(result);
                    history.push({role:'tool',name:call.name,tool_call_id:call.id,content});
                    await this.agent.history?.add('system',`${call.name}: ${content}`);
                    this.lastResults.push({name:call.name,...result});this.lastResults=this.lastResults.slice(-8);
                    if(!control) {this.lastResultAt=Date.now();this.lastResultOk=['ok','partial'].includes(result?.status);
                        journal('tool',{tool:call.name,status:result?.status,text:String(result?.text||'').slice(0,160)},this.agent.bot);}
                    // put back nearby blocks it broke (protected areas, surface holes, saplings) without a model request
                    if(!control&&!this.cancelJob) await restoreBetweenTools(this.agent).catch(error=>console.warn('restore:',error.message));
                    // valuable ore in sight (diamonds) is always taken along, without a model request
                    if(!control&&!this.cancelJob) await grabValuables(this.agent).catch(error=>console.warn('valuables:',error.message));
                    if(!control) await narrator.afterTool(result,call);
                    if(handoff) break;
                }
                await this.agent.history?.save();
                if(handoff) return {...handoff,steps:step,usedTool};
                if(executed>=callLimit) return {chat_response:"Das klappt gerade nicht. Gib mir bitte einen kleineren Schritt.",steps:step,work_done:false,usedTool};
                if(!calls.length) {
                    if(conversation) return {chat_response:visible,steps:step,work_done:true,usedTool};
                    if(parsed?.work_done===true) return {chat_response:visible,steps:step,work_done:true,usedTool};
                    noTools++;
                    if(this.agent.decisions?.enabled) {
                        const status=await this.agent.decisions.taskStatus(this.currentTaskDescription,this.lastResults);
                        if(status==='done') return {chat_response:visible,steps:step,work_done:true,usedTool};
                        if(status==='blocked') return {chat_response:visible||'Task blocked.',steps:step,work_done:false,blocked:true,usedTool};
                    }
                    if(noTools>=3) return {chat_response:"So komme ich nicht weiter. Gib mir bitte einen kleineren Schritt.",steps:step,work_done:false,blocked:true,usedTool};
                    history.push({role:'user',content:'Continue the next concrete step with native tools, or call taskDone/taskBlocked with evidence.'});
                } else noTools=0;
            }
            return {chat_response:this.cancelJob||shouldInterrupt()?'':"Das klappt gerade nicht. Gib mir bitte einen kleineren Schritt.",steps:this.currentStep,work_done:false,usedTool};
        } catch(error) {
            if(this.cancelJob||shouldInterrupt()) return {chat_response:'',steps:this.currentStep,work_done:false,usedTool};
            throw error;
        } finally {
            narrator?.close();this.narrator=null;this.requestRole=null;
            this.is_running=wasRunning;
        }
    }
    cancelTask() {
        this.cancelJob=true;this.narrator?.close();
        if(this.requestRole) this.agent.prompter?.cancelPending?.(this.requestRole);
    }
    _parseResponse(text) {return parseObject(text);}
}
