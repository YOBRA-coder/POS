const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('posPrint',()=>ipcRenderer.invoke('print'));
