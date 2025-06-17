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
 */

// Some original methods are derived from https://github.com/ali-raheem/Aify/blob/cfadf52f576b7be3720b5b73af7c8d3129c054da/plugin/html/actions.js

import { getPrompts } from './mzta-prompts.js';
import { getLanguageDisplayName, getMenuContextCompose, getMenuContextDisplay, i18nConditionalGet, getMailSubject, getTagsList, extractJsonObject } from './mzta-utils.js'
import { taPromptUtils } from './mzta-utils-prompt.js';
import { taLogger } from './mzta-logger.js';
import { placeholdersUtils } from './mzta-placeholders.js';
import { mzta_specialCommand } from './mzta-special-commands.js';
import { taWorkingStatus } from './mzta-working-status.js';
 
export class mzta_Menus {

    allPrompts = [];
    openChatGPT = null;
    menu_context_compose = null;
    menu_context_display = null;
    menu_listeners = {};
    logger = null;

    rootMenu = [
    //{ id: 'ItemC', act: (info, tab) => { console.log('ItemC', info, tab, info.menuItemId); alert('ItemC') } },
    ];

    shortcutMenu = [
    //{ id: 'ItemD', label: 'LabelD' },
    ];

    constructor(openChatGPT, do_debug = false) {
        this.menu_context_compose = getMenuContextCompose();
        this.menu_context_display = getMenuContextDisplay();
        this.openChatGPT = openChatGPT;
        this.allPrompts = [];
        this.listener = this.listener.bind(this);
        this.logger = new taLogger('mzta_Menus', do_debug);
    }


    async initialize(also_special = []) {    // also_special is an array of active special prompts ids
        this.allPrompts = [];
        this.rootMenu = [];
        this.shortcutMenu = [];
        this.menu_listeners = {};
        this.allPrompts = await getPrompts(true,also_special);   
        this.allPrompts.sort((a, b) => a.name.localeCompare(b.name));
        this.allPrompts.forEach((prompt) => {
            this.addAction(prompt)
        });
    }

    async reload(also_special = []) {
        // await browser.menus.removeAll().catch(error => {
        //         console.error("[ThunderAI] ERROR removing the menus: ", error);
        //     });
        this.removeClickListener();
        this.loadMenus(also_special);
    }

    addAction = (curr_prompt) => {

        let curr_menu_entry = {id: curr_prompt.id, is_default: curr_prompt.is_default, name: curr_prompt.name};
        let curr_message = null;
    
        const getMailBody = async (tabs, do_autoselect = false) => {
            //const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            return {tabId: tabs[0].id, 
                selection: await browser.tabs.sendMessage(tabs[0].id, { command: "getSelectedText" }),
                selection_html: await browser.tabs.sendMessage(tabs[0].id, { command: "getSelectedHtml" }),
                text: await browser.tabs.sendMessage(tabs[0].id, { command: "getTextOnly" }),
                html: await browser.tabs.sendMessage(tabs[0].id, { command: "getFullHtml" }),
                only_typed_text: await browser.tabs.sendMessage(tabs[0].id, { command: "getOnlyTypedText", do_autoselect: do_autoselect }),
                only_quoted_text: await browser.tabs.sendMessage(tabs[0].id, { command: "getOnlyQuotedText" })
            };
        };
    
        curr_menu_entry.act = async () => {
            taWorkingStatus.startWorking();
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            const msg_text = await getMailBody(tabs, placeholdersUtils.hasPlaceholder(curr_prompt.text,'mail_typed_text'));
    
            //check if a selection is needed
            if(String(curr_prompt.need_selected) == "1" && (msg_text.selection==='')){
                //A selection is needed, but nothing is selected!
                //alert(browser.i18n.getMessage('prompt_selection_needed'));
                browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", curr_tab_type: tabs[0].type, message : browser.i18n.getMessage('prompt_selection_needed') });
                taWorkingStatus.stopWorking();
                return {ok:'0'};
            }
    
            let body_text = '';
            let selection_text = '';
            let selection_html = msg_text.selection_html;
            let only_typed_text = '';
            let only_quoted_text = '';
            only_typed_text = msg_text.only_typed_text.replace(/\s+/g, ' ').trim();
            selection_text = msg_text.selection.replace(/\s+/g, ' ').trim();
            if(selection_text === ''){
                if(placeholdersUtils.hasPlaceholder(curr_prompt.text, "mail_typed_text")){
                    selection_text = only_typed_text;
                }
            }
            only_quoted_text = msg_text.only_quoted_text.replace(/\s+/g, ' ').trim();
            curr_prompt.selection_text = selection_text;
            curr_prompt.selection_html = selection_html;
            body_text = msg_text.text.replace(/\s+/g, ' ').trim();
            curr_prompt.body_text = body_text;
            //open chatgpt window
            //console.log("Click menu item...");
            let chatgpt_lang = await taPromptUtils.getDefaultLang(curr_prompt);
            
            let fullPrompt = '';
            let tags_full_list = await getTagsList();

            let curr_messages = null;
            switch(tabs[0].type){
                case 'mail':
                    curr_messages = await browser.mailTabs.getSelectedMessages();
                    curr_message = curr_messages.messages[0];
                    break;
                case 'messageDisplay':
                    curr_messages = await messenger.messageDisplay.getDisplayedMessage(tabs[0].id);
                    curr_message = curr_messages;
                    break;
                case 'messageCompose':
                    curr_messages = await browser.compose.getComposeDetails(tabs[0].id);
                    curr_message = curr_messages;
                    break;
            }

            fullPrompt = await taPromptUtils.preparePrompt(curr_prompt, curr_message, chatgpt_lang, selection_text, selection_html, body_text, await getMailSubject(tabs[0]), msg_text, only_typed_text, only_quoted_text, tags_full_list);
            
            switch(curr_prompt.id){
                case 'prompt_translate_this':
                    let prefs2 = await browser.storage.sync.get({default_chatgpt_lang: getLanguageDisplayName(browser.i18n.getUILanguage())});
                    let chatgpt_lang2 = prefs2.default_chatgpt_lang;
                    if(chatgpt_lang2 === ''){
                        chatgpt_lang2 = getLanguageDisplayName(browser.i18n.getUILanguage());
                    }
                    fullPrompt = curr_prompt.text + " " + chatgpt_lang2 + ". \"" + body_text + "\" ";
                    break;
                case 'prompt_reply':
                    fullPrompt += browser.i18n.getMessage("prompt_reply_additional_text");
                    break;
                default:
                    break;
            }

            // const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            // add custom text if needed
            //browser.runtime.sendMessage({command: "chatgpt_open", prompt: fullPrompt, action: curr_prompt.action, tabId: tabs[0].id});
            if(curr_prompt.is_special == '1'){  // Special prompts
                switch(curr_prompt.id){
                    case 'prompt_add_tags': {   // Add tags to the email
                        let tags_current_email = [];
                        let prefs_at = await browser.storage.sync.get({add_tags_maxnum: 3, connection_type: '', add_tags_force_lang: true, default_chatgpt_lang: '', do_debug: false});
                        if((prefs_at.connection_type === '')||(prefs_at.connection_type === null)||(prefs_at.connection_type === undefined)||(prefs_at.connection_type === 'chatgpt_web')){
                            console.error("[ThunderAI | AddTags] Invalid connection type: " + prefs_at.connection_type);
                            taWorkingStatus.stopWorking();
                            return {ok:'0'};
                        }
                        fullPrompt = taPromptUtils.finalizePrompt_add_tags(fullPrompt, prefs_at.add_tags_maxnum, prefs_at.add_tags_force_lang, prefs_at.default_chatgpt_lang);
                        this.logger.log("fullPrompt: " + fullPrompt);
                        // TODO: use the current API, abort if using chatgpt web
                        // COMMENTED TO DO TESTS
                        // tags_current_email = "recipients, TEST, home, work, CAR, light";
                        let cmd_addTags = new mzta_specialCommand(fullPrompt,prefs_at.connection_type,prefs_at.do_debug);
                        await cmd_addTags.initWorker();
                        try{
                            tags_current_email = taPromptUtils.getTagsFromResponse(await cmd_addTags.sendPrompt());
                            // console.log(">>>>>>>>>>> tags_current_email: " + tags_current_email);
                        }catch(err){
                            console.error("[ThunderAI] Error getting tags: ", err);
                            browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", curr_tab_type: tabs[0].type, message: "Error getting tags: " + err });
                            taWorkingStatus.stopWorking();
                            return {ok:'0'};
                        }
                        this.logger.log("tags_current_email: " + JSON.stringify(tags_current_email));
                        this.logger.log("tags_full_list: " + JSON.stringify(tags_full_list));
                        browser.tabs.sendMessage(tabs[0].id, {command: "getTags", tags: tags_current_email, messageId: curr_message.id});
                        taWorkingStatus.stopWorking();
                        return {ok:'1'};
                        break;  // Add tags to the email - END
                    }
                    case 'prompt_get_calendar_event': {  // Get a calendar event info
                        let calendar_event_data = '';
                        let prefs_at = await browser.storage.sync.get({connection_type: '', calendar_enforce_timezone: false, calendar_timezone: '',});
                        if((prefs_at.connection_type === '')||(prefs_at.connection_type === null)||(prefs_at.connection_type === undefined)||(prefs_at.connection_type === 'chatgpt_web')){
                            console.error("[ThunderAI | GetCalendarEvent] Invalid connection type: " + prefs_at.connection_type);
                            taWorkingStatus.stopWorking();
                            return {ok:'0'};
                        }
                        /* We expect to receive from the AI a JSON object like this:
                        *  {
                        *   "startDate": "20250104T183000Z",
                        *   "endDate": "20250104T193000Z",
                        *   "summary": "ThunderAI Sparks",
                        *   "forceAllDay": false,
                        *   "attendees": [attendee1@example.com,attendee2@example.com,attendee3@example.com]"
                        *  } 
                        */
                        fullPrompt = taPromptUtils.finalizePrompt_get_calendar_event(fullPrompt);
                        this.logger.log("fullPrompt: " + fullPrompt);
                        let cmd_GetCalendarEvent = new mzta_specialCommand(fullPrompt,prefs_at.connection_type,true);
                        await cmd_GetCalendarEvent.initWorker();
                        try{
                            calendar_event_data = await cmd_GetCalendarEvent.sendPrompt();
                            // console.log(">>>>>>>>>>> calendar_event_data: " + calendar_event_data);
                        }catch(err){
                            console.error("[ThunderAI] Error getting calendar event data: ", err.message);
                            browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage("calendar_getting_data_error") + ": " + err.message });
                            taWorkingStatus.stopWorking();
                            return {ok:'0'};
                        }
                        let calendar_event_data_obj = {};
                        try{
                            calendar_event_data_obj = extractJsonObject(calendar_event_data);
                        }catch(err){
                            console.error("[ThunderAI] Error extracting JSON object from calendar event data: ", err.message);
                            browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage("calendar_getting_data_error") + ": " + err.message });
                            taWorkingStatus.stopWorking();
                            return {ok:'0'};
                        }
                        // Timezone management
                        calendar_event_data_obj.use_timezone = false;
                        if(prefs_at.calendar_enforce_timezone){
                            calendar_event_data_obj.use_timezone = true;
                            calendar_event_data_obj.timezone = prefs_at.calendar_timezone;
                        }
                        let calendar_event_data_str = JSON.stringify(calendar_event_data_obj);
                        // Timezone management - END
                        this.logger.log("calendar_event_data: " + calendar_event_data);
                        this.logger.log("calendar_event_data_obj: " + calendar_event_data_str);
                        try{
                            let result_openCalendarEventDialog = await browser.runtime.sendMessage('thunderai-sparks@micz.it',{action: "openCalendarEventDialog", calendar_event_data: calendar_event_data_str})
                            if(result_openCalendarEventDialog == 'ok'){
                                taWorkingStatus.stopWorking();
                                return {ok:'1'};
                            } else {
                                let err = result_openCalendarEventDialog.error;
                                if (err && typeof err === 'string' && err.startsWith('|>>')) {
                                    result_openCalendarEventDialog.error = browser.i18n.getMessage(result_openCalendarEventDialog.error.substring(3));
                                }
                                browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage("calendar_opening_dialog_error") + ": " + result_openCalendarEventDialog.error });
                                taWorkingStatus.stopWorking();
                                return {ok:'0'};
                            }
                        }catch(err){
                            console.error("[ThunderAI] Error opening calendar event dialog: ", err);
                            browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage("calendar_opening_dialog_error") + ": " + browser.i18n.getMessage("no_valid_data_received") });
                            taWorkingStatus.stopWorking();
                            return {ok:'0'};
                        }
                        break;  // Get a calendar event info - END
                    }
                    case 'prompt_get_task': {  // Get a task info
                        let task_data = '';
                        let prefs_at = await browser.storage.sync.get({connection_type: '', calendar_enforce_timezone: false, calendar_timezone: '',});
                        if((prefs_at.connection_type === '')||(prefs_at.connection_type === null)||(prefs_at.connection_type === undefined)||(prefs_at.connection_type === 'chatgpt_web')){
                            console.error("[ThunderAI | GetTask] Invalid connection type: " + prefs_at.connection_type);
                            taWorkingStatus.stopWorking();
                            return {ok:'0'};
                        }
                        /* We expect to receive from the AI a JSON object like this:
                        *  {
                        *   "InitialDate": "YYYYMMDDTHHMMSS",
                        *   "dueDate": "YYYYMMDDTHHMMSS",
                        *   "summary": "Task summary here"
                        *  } 
                        */
                        this.logger.log("fullPrompt: " + fullPrompt);
                        let cmd_GetTask = new mzta_specialCommand(fullPrompt,prefs_at.connection_type,true);
                        await cmd_GetTask.initWorker();
                        try{
                            task_data = await cmd_GetTask.sendPrompt();
                            // console.log(">>>>>>>>>>> task_data: " + task_data);
                        }catch(err){
                            console.error("[ThunderAI] Error getting task data: ", err.message);
                            browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage("task_getting_data_error") + ": " + err.message });
                            taWorkingStatus.stopWorking();
                            return {ok:'0'};
                        }
                        let task_data_obj = {};
                        try{
                            task_data_obj = extractJsonObject(task_data);
                            if (!task_data_obj.dueDate || isNaN(Date.parse(task_data_obj.dueDate)) || task_data_obj.dueDate == '' ) {
                                delete task_data_obj.dueDate;
                            }
                            if (!task_data_obj.InitialDate || isNaN(Date.parse(task_data_obj.InitialDate)) || task_data_obj.InitialDate == '' ) {
                                delete task_data_obj.InitialDate;
                            }
                        }catch(err){
                            console.error("[ThunderAI] Error extracting JSON object from task data: ", err.message);
                            browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage("task_getting_data_error") + ": " + err.message });
                            taWorkingStatus.stopWorking();
                            return {ok:'0'};
                        }
                        // Timezone management
                        task_data_obj.use_timezone = false;
                        if(prefs_at.calendar_enforce_timezone){
                            task_data_obj.use_timezone = true;
                            task_data_obj.timezone = prefs_at.calendar_timezone;
                        }
                        let task_data_str = JSON.stringify(task_data_obj);
                        // Timezone management - END
                        this.logger.log("task_data: " + task_data);
                        this.logger.log("task_data_obj: " + task_data_str);
                        try{
                            let result_openTaskDialog = await browser.runtime.sendMessage('thunderai-sparks@micz.it',{action: "openTaskDialog", task_data: task_data_str})
                            if(result_openTaskDialog == 'ok'){
                                taWorkingStatus.stopWorking();
                                return {ok:'1'};
                            } else {
                                let err = result_openTaskDialog.error;
                                if (err && typeof err === 'string' && err.startsWith('|>>')) {
                                    result_openTaskDialog.error = browser.i18n.getMessage(result_openTaskDialog.error.substring(3));
                                }
                                browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage("task_opening_dialog_error") + ": " + result_openTaskDialog.error });
                                taWorkingStatus.stopWorking();
                                return {ok:'0'};
                            }
                        }catch(err){
                            console.error("[ThunderAI] Error opening task dialog: ", err);
                            browser.tabs.sendMessage(tabs[0].id, { command: "sendAlert", curr_tab_type: tabs[0].type, message: browser.i18n.getMessage("task_opening_dialog_error") + ": " + browser.i18n.getMessage("no_valid_data_received") });
                            taWorkingStatus.stopWorking();
                            return {ok:'0'};
                        }
                        break;
                    }   // Get a task info - END
                    default:
                        console.error("[ThunderAI] Unknown special prompt id: " + curr_prompt.id);
                        taWorkingStatus.stopWorking();
                        return {ok:'0'};
                        break;
                }
            }else{  // Classic prompts for the API webchat
                this.logger.log("fullPrompt: " + fullPrompt);
                this.openChatGPT(fullPrompt, curr_prompt.action, tabs[0].id, curr_prompt.name, curr_prompt.need_custom_text, curr_prompt);
                taWorkingStatus.stopWorking();
                return {ok:'1'};
            }
        };
        this.rootMenu.push(curr_menu_entry);
    };

    loadShortcutMenu() {
        this.shortcutMenu = [];
        this.allPrompts.forEach((prompt) => {
            this.addShortcutMenu(prompt);
        });
    }

    addShortcutMenu(prompt) {
        let curr_menu_entry = {id: prompt.id, label: i18nConditionalGet(prompt.name), type: prompt.type};
        this.shortcutMenu.push(curr_menu_entry);
    }

    async loadMenus(also_special = []) {
        await this.initialize(also_special);
        await this.addMenu(this.rootMenu);
        this.addClickListener();
        this.loadShortcutMenu();
        this.logger.log("Menus loaded");
    }

    listener(info, tab) {
        let listeners = this.menu_listeners;
        if (listeners[info.menuItemId]) {
            listeners[info.menuItemId](info, tab);
        }
    }

    addClickListener() {
        browser.menus.onClicked.addListener(this.listener);
    }

    removeClickListener() {
        browser.menus.onClicked.removeListener(this.listener);
    }

    addMenu = async (menu, root = null) => {
        for (let item of menu) {
          let {id, is_default, name, menu, act} = item;

          this.logger.log("addMenu: " + id);

        //   await new Promise(resolve =>
        //     browser.menus.create({
        //         id: id,
        //         title: this.getCustomTextAttribute(id) + is_default == 1 ? (browser.i18n.getMessage(id) || name) : name,
        //         contexts: this.getContexts(id),
        //         parentId: root
        //       },
        //       resolve
        //     )
        //   );
      
          if (act) {
            this.menu_listeners[id] = act;
          }
      
          if (menu) {
            await this.addMenu(menu, id);
          }
        }
      
    };

    getContexts(id){
        //console.log(">>>>>>>>> id: " + id);
        const curr_prompt = this.allPrompts.find(p => p.id === id);
        //console.log(">>>>>>>>>> curr_prompt: " + JSON.stringify(curr_prompt));
        if (!curr_prompt) {
          return [];
        }
        switch(String(curr_prompt.type)){
            case "0":
                return [this.menu_context_compose, this.menu_context_display];
            case "1":
                return [this.menu_context_display];
            case "2":
                return [this.menu_context_compose];
            default:
                return [];
        }

    }

    getCustomTextAttribute(id){
        const curr_prompt = this.allPrompts.find(p => p.id === id);
        if (!curr_prompt) {
          return "";
        }
        if(String(curr_prompt.need_custom_text) === "1"){
            return "*";
        }else{
            return "";
        }
    }


    async executeMenuAction(id) {
        // Retrieve the action callback from the menu listeners using the provided ID
        const action = this.menu_listeners[id];
        
        if (action) {
            try {
                // Execute the action callback
                return await action();
            } catch (error) {
                // Log any errors that occur during execution
                console.error(`Error executing action for menu item ${id}:`, error);
            }
        } else {
            // Warn if no action is found for the provided ID
            console.warn(`No action found for menu item ID: ${id}`);
        }
        return false;
    }

}