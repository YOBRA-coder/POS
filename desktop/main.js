// Electron shell: runs the POS server inside the app and opens it full-screen. Silent receipt printing via window.posPrint.
const {app,BrowserWindow,ipcMain}=require('electron'),path=require('path');
process.env.DB=process.env.DB||path.join(app.getPath('userData'),'pos.db');
process.env.BACKUP_DIR=process.env.BACKUP_DIR||path.join(app.getPath('userData'),'backups');
const PORT=process.env.PORT||3210;let win;
app.whenReady().then(()=>{require('../server.js').start(PORT);
 win=new BrowserWindow({fullscreen:!process.env.POS_WINDOWED,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js')}});
 win.loadURL('http://localhost:'+PORT);
 ipcMain.handle('print',()=>win.webContents.print({silent:true,printBackground:false,deviceName:process.env.PRINTER_NAME||''}))});
app.on('window-all-closed',()=>app.quit());
