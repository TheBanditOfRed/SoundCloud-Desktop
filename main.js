const { app, BrowserWindow, shell, nativeImage, globalShortcut, systemPreferences, ipcMain } = require('electron');
const { nativeTheme } = require('electron');
const path = require('path');
const MediaManager = require('./media-manager');

let mainWindow;
let popupWindow = null;
let mediaManager;
let mediaState = {
    isPlaying: false,
    canGoNext: true,
    canGoPrevious: true,
    trackTitle: '',
    trackArtist: ''
};

function createWindow() {
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, 'assets/icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            experimentalFeatures: false
        },
        title: 'SoundCloud Desktop',
        show: false // Don't show until ready
    });

    // Initialize media manager
    mediaManager = new MediaManager(mainWindow, mediaState);

    function updateScrollbarTheme() {
        const isDark = nativeTheme.shouldUseDarkColors;

        mainWindow.webContents.insertCSS(`
            ::-webkit-scrollbar {
                width: 12px;
            }
            ::-webkit-scrollbar-track {
                background: ${isDark ? '#2d2d2d' : '#f1f1f1'};
            }
            ::-webkit-scrollbar-thumb {
                background: ${isDark ? '#555' : '#c1c1c1'};
            }
            ::-webkit-scrollbar-thumb:hover {
                background: ${isDark ? '#777' : '#a8a8a8'};
            }
        `).then(_ => {
            console.log('Scrollbar theme updated successfully');
        });
    }

    updateScrollbarTheme();

    // Load SoundCloud
    mainWindow.loadURL('https://soundcloud.com').then(_ => {
        console.log('SoundCloud loaded successfully');
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();

        setTimeout(() => {
            mediaManager.initialize();
        }, 1000);
    });

    nativeTheme.on('updated', () => {
        console.log('Native theme updated, refreshing styles');
        updateScrollbarTheme();
        if (mediaManager) {
            mediaManager.updateControls();
        }
    });

    // Handle window closed
    mainWindow.on('closed', () => {
        if (mediaManager) {
            mediaManager.cleanup();
        }
        mainWindow = null;
    });

    // Handle external links and popups
    mainWindow.webContents.setWindowOpenHandler(({ url, frameName, disposition }) => {
        console.log('=== POPUP REQUEST ===');
        console.log('URL:', url);
        console.log('Frame:', frameName);
        console.log('Disposition:', disposition);

        if (disposition === 'new-window' || disposition === 'popup') {
            if (url === 'about:blank' || url.includes('about:blank')) {
                console.log('Creating popup window for dynamic content');

                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: {
                        width: 500,
                        height: 650,
                        webPreferences: {
                            nodeIntegration: false,
                            contextIsolation: true,
                            enableRemoteModule: false,
                            webSecurity: true
                        },
                        parent: mainWindow,
                        modal: false,
                        show: true,
                        resizable: false,
                        center: true
                    }
                };
            }

            if (url.includes('soundcloud.com') ||
                url.includes('google.com') ||
                url.includes('accounts.google.com') ||
                url.includes('facebook.com') ||
                url.includes('twitter.com') ||
                url.includes('oauth') ||
                url.includes('login') ||
                url.includes('auth')) {

                console.log('Creating popup window for:', url);

                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: {
                        width: 500,
                        height: 650,
                        webPreferences: {
                            nodeIntegration: false,
                            contextIsolation: true,
                            enableRemoteModule: false,
                            webSecurity: true
                        },
                        parent: mainWindow,
                        modal: false,
                        show: true,
                        resizable: false,
                        center: true
                    }
                };
            }
        }

        console.log('Opening in system browser:', url);
        shell.openExternal(url).then(_ => {
            console.log('Attempting to open external URL in system browser:', url);
        });
        return { action: 'deny' };
    });

    mainWindow.setMenu(null);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (mediaManager) {
        mediaManager.cleanup();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('will-quit', () => {
    if (mediaManager) {
        mediaManager.cleanup();
    }
});

function checkURL(contents) {
    contents.on('will-navigate', (event, navigationUrl) => {
        console.log('Will navigate to:', navigationUrl);

        try {
            const parsedUrl = new URL(navigationUrl);

            if (parsedUrl.origin === 'https://soundcloud.com' ||
                parsedUrl.origin === 'https://secure.soundcloud.com' ||
                parsedUrl.origin === 'https://accounts.google.com' ||
                parsedUrl.origin === 'https://google.com' ||
                parsedUrl.hostname.endsWith('.google.com') ||
                parsedUrl.hostname.endsWith('.gstatic.com') ||
                parsedUrl.hostname.endsWith('.googleusercontent.com') ||
                parsedUrl.hostname.endsWith('.facebook.com') ||
                parsedUrl.hostname.endsWith('.doubleclick.net') ||
                parsedUrl.hostname.endsWith('.googletagmanager.com') ||
                navigationUrl.includes('oauth') ||
                navigationUrl.includes('auth') ||
                navigationUrl.includes('login')) {
                console.log('Allowing navigation to:', navigationUrl);
                return;
            }

            if (contents === mainWindow.webContents) {
                console.log('Blocking navigation in main window to:', navigationUrl);
                event.preventDefault();
                shell.openExternal(navigationUrl).then(_ => {
                    console.log('Attempting to open external URL in system browser:', navigationUrl);
                });
            } else {
                console.log('Allowing popup navigation to:', navigationUrl);
            }
        } catch (error) {
            console.log('Error parsing URL:', navigationUrl, error);
            if (contents !== mainWindow.webContents) {
                console.log('Allowing popup navigation to unparseable URL');
            }
        }
    });
}

function checkLoading(contents) {
    contents.on('did-finish-load', () => {
        const currentUrl = contents.getURL();
        console.log('=== PAGE LOADED ===');
        console.log('Current URL:', currentUrl);

        if (contents !== mainWindow.webContents) {
            if (currentUrl.includes('web-auth-callback') ||
                currentUrl.includes('oauth/callback') ||
                (currentUrl === 'https://soundcloud.com/' && !currentUrl.includes('oauth') && !currentUrl.includes('login') && !currentUrl.includes('auth'))) {

                console.log('OAuth callback detected in popup:', currentUrl);
            }
        }
    });
}

function windowCreated(contents) {
    contents.on('did-create-window', (window, details) => {
        console.log('=== POPUP WINDOW CREATED ===');
        console.log('Details:', details);

        popupWindow = window;

        window.webContents.on('did-navigate', (event, url) => {
            console.log('=== POPUP NAVIGATED ===');
            console.log('Popup URL:', url);
        });

        window.on('closed', () => {
            console.log('=== POPUP WINDOW CLOSED ===');
            popupWindow = null;
        });
    });
}

app.on('web-contents-created', (event, contents) => {
    console.log('=== NEW WEB CONTENTS CREATED ===');
    checkURL(contents);
    checkLoading(contents);
    windowCreated(contents);
});