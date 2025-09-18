/*
 *  ThunderAI [https://micz.it/thunderbird-addon-thunderai/]
 *  Copyright (C) 2024 - 2025  Mic (m@micz.it)

 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.

 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.

 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 * 
 * 
 *  This file contains a modified version of the code from the project at https://github.com/boxabirds/chatgpt-frontend-nobuild
 *  The original code has been released under the Apache License, Version 2.0.
 */

import { Ollama } from '../api/ollama.js';
import { taLogger } from '../mzta-logger.js';

let ollama_host = null;
let ollama_model = '';
let ollama_num_ctx = 0;
let ollama = null;
let stopStreaming = false;
let i18nStrings = null;
let do_debug = false;
let taLog = null;

let conversationHistory = [];
let assistantResponseAccumulator = '';

self.onmessage = async function(event) {
    switch (event.data.type) {
        case 'init':
            ollama_host = event.data.ollama_host;
            ollama_model = event.data.ollama_model;
            ollama_num_ctx = event.data.ollama_num_ctx;
            //console.log(">>>>>>>>>>> ollama_host: " + ollama_host);
            ollama = new Ollama({
                host: ollama_host,
                model: ollama_model,
                stream: true,
                num_ctx: ollama_num_ctx
            });
            do_debug = event.data.do_debug;
            i18nStrings = event.data.i18nStrings;
            taLog = new taLogger('model-worker-ollama', do_debug);
            break;  // init
        case 'chatMessage':
            conversationHistory.push({ role: 'user', content: event.data.message });
            //console.log(">>>>>>>>>>> conversationHistory: " + JSON.stringify(conversationHistory));
            const response = await ollama.fetchResponse(conversationHistory); //4096);
            postMessage({ type: 'messageSent' });

            if (!response.ok) {
                let error_message = '';
                let errorDetail = '';
                if(response.is_exception === true){
                    error_message = response.error;
                }else{
                    try{
                        const errorJSON = await response.json();
                        errorDetail = JSON.stringify(errorJSON);
                        error_message = errorJSON.error.message;
                    }catch(e){
                        error_message = response.statusText;
                    }
                    taLog.log("error_message: " + JSON.stringify(error_message));
                }
                postMessage({ type: 'error', payload: i18nStrings["ollama_api_request_failed"] + ": " + response.status + " " + response.statusText + ", Detail: " + error_message + " " + errorDetail });
                throw new Error("[ThunderAI] Ollama API request failed: " + response.status + " " + response.statusText + ", Detail: " + error_message + " " + errorDetail);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer= '';
    
            try {
                while (true) {
                    if (stopStreaming) {
                        stopStreaming = false;
                        reader.cancel();
                        conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                        assistantResponseAccumulator = '';
                        postMessage({ type: 'tokensDone' });

                        break;
                    }
                    const { done, value } = await reader.read();
                    if (done) {
                        conversationHistory.push({ role: 'assistant', content: assistantResponseAccumulator });
                        assistantResponseAccumulator = '';
                        postMessage({ type: 'tokensDone' });
                        break;
                    }
                    // lots of low-level Ollama response parsing stuff
                    const chunk = decoder.decode(value);
                    buffer += chunk;
                    taLog.log("buffer: " + buffer);
                    const lines = buffer.split("\n");
                    buffer = lines.pop();
                    let parsedLines = [];
                    try{
                        parsedLines = lines
                            .map((line) => line.replace(/^chunk: /, "").trim()) // Remove the "chunk: " prefix
                            .filter((line) => line !== "" && line !== "[DONE]") // Remove empty lines and "[DONE]"
                            // .map((line) => JSON.parse(line)); // Parse the JSON string
                            .map((line) => {
                                taLog.log("line: " + JSON.stringify(line));
                                return JSON.parse(line);
                            });
                    }catch(e){
                        taLog.error("Error parsing lines: " + e);
                    }
            
                    for (const parsedLine of parsedLines) {
                        const { message } = parsedLine;
                        const { content } = message;
                        // Update the UI with the new content
                        if (content) {
                            assistantResponseAccumulator += content;
                            postMessage({ type: 'newToken', payload: { token: content } });
                        }
                    }
                }
            } catch (error) {
                if (error instanceof TypeError && error.message.includes('Error in input stream')) {
                    console.error('[ThudenderAI] The connection to the server was unexpectedly interrupted:', error);
                    postMessage({ type: 'error', payload: i18nStrings['error_connection_interrupted'] + ": " + error.message });
                } else {
                    console.error('[ThudenderAI] Ollama API request failed:', error);
                    postMessage({ type: 'error', payload: i18nStrings["ollama_api_request_failed"] + ": " + error.message });
                }
            }
            break; //chatMessage
        case 'stop':
            stopStreaming = true;
            break; //stop
     }
};
