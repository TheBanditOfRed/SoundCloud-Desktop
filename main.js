const { app, BrowserWindow, shell, nativeImage} = require('electron');
const { nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
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

function resizeIcon(iconPath, icon) {
    // const sizes = [16, 24, 32, 48, 64, 128, 256];
    const resizedIcon = icon.resize({ width: 48, height: 48 });

    console.log('Using icon from:', iconPath);
    console.log('Resized icon size:', resizedIcon.getSize());

    return resizedIcon;
}

function createIcon() {
    debugIcon();

    const possiblePaths = [
        path.join(__dirname, 'assets', 'icon.png'),
        path.join(__dirname, 'assets/icon.png'),
        path.join(__dirname, 'icon.png'),
        path.join(process.cwd(), 'assets', 'icon.png')
    ];

    for (const iconPath of possiblePaths) {
        if (fs.existsSync(iconPath)) {
            console.log(`Trying to load icon from: ${iconPath}`);

            try {
                const icon = nativeImage.createFromPath(iconPath);
                console.log('Icon loaded successfully');
                console.log('Icon size:', icon.getSize());
                console.log('Icon is empty:', icon.isEmpty());
                console.log('Icon aspect ratio:', icon.getAspectRatio());

                if (process.platform === 'linux' && !icon.isEmpty()) {
                   return resizeIcon(iconPath, icon);
                }

            } catch (error) {
                console.log('Error loading icon:', error);
            }
        }
    }

    console.log('No valid icon found');

}

function createWindow() {
    const windowIcon = createIcon();

    if (process.platform === 'linux' && windowIcon) {
        app.setAppUserModelId('com.TheBanditOfRed.soundcloud-desktop');

        if (windowIcon && !windowIcon.isEmpty()) {
            const tempIconPath = path.join(require('os').tmpdir(), 'soundcloud-desktop-icon.png');
            try {
                fs.writeFileSync(tempIconPath, windowIcon.toPNG());
                console.log('Temporary icon saved to:', tempIconPath);
            } catch (error) {
                console.log('Could not save temporary icon:', error);
            }
        }
    }

    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: windowIcon,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            experimentalFeatures: false,
            hardwareAcceleration: false,
            offscreen: false
        },
        title: 'SoundCloud Desktop',
        show: false,
        ...(process.platform === 'linux' && {
            skipTaskbar: false,
            autoHideMenuBar: true,
            useContentSize: true
        })
    });

    if (process.platform === 'linux' && windowIcon) {
        try {
            mainWindow.setIcon(windowIcon);
            console.log('Icon set via setIcon() method');

            setTimeout(() => {
                mainWindow.setIcon(windowIcon);
                console.log('Icon re-set after timeout');
            }, 1000);

        } catch (error) {
            console.log('Error setting icon:', error);
        }
    }

    if (windowIcon) {
        mainWindow.setIcon(windowIcon);
        console.log('Icon set via setIcon() method');
    }

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
            
            /* Force system fonts for better Linux compatibility */
            * {
                font-family: -webkit-system-font, system-ui, sans-serif !important;
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

        // Force title update for Linux
        mainWindow.setTitle('SoundCloud Desktop');
        console.log('Window title set to: SoundCloud Desktop');

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

function setupLinuxIconSupport() {
    if (process.platform === 'linux') {
        app.setAppUserModelId('com.TheBanditOfRed.soundcloud-desktop');
    }
}

app.whenReady().then(() => {
    setupLinuxIconSupport();
    createWindow();
});


function debugIcon() {
    console.log('=== ICON DEBUG INFO ===');
    console.log('Platform:', process.platform);
    console.log('Current working directory:', process.cwd());
    console.log('__dirname:', __dirname);

    if (process.platform === 'linux') {
        console.log('Desktop environment:', process.env.DESKTOP_SESSION);
        console.log('Display server:', process.env.WAYLAND_DISPLAY ? 'Wayland' : 'X11');
        console.log('Icon theme:', process.env.ICON_THEME);
    }

    const possiblePaths = [
        path.join(__dirname, 'assets', 'icon.png'),
        path.join(__dirname, 'assets/icon.png'),
        path.join(__dirname, 'icon.png'),
        path.join(process.cwd(), 'assets', 'icon.png'),
        path.join(process.cwd(), 'assets/icon.png'),
        path.join(process.cwd(), 'icon.png')
    ];

    possiblePaths.forEach((iconPath, index) => {
        console.log(`Path ${index + 1}: ${iconPath}`);
        console.log(`  Exists: ${fs.existsSync(iconPath)}`);
        if (fs.existsSync(iconPath)) {
            const stats = fs.statSync(iconPath);
            console.log(`  Size: ${stats.size} bytes`);
            console.log(`  Modified: ${stats.mtime}`);

            if (process.platform === 'linux') {
                try {
                    const icon = nativeImage.createFromPath(iconPath);
                    console.log(`  Valid icon: ${!icon.isEmpty()}`);
                    console.log(`  Icon dimensions: ${icon.getSize().width}x${icon.getSize().height}`);
                } catch (error) {
                    console.log(`  Icon load error: ${error.message}`);
                }
            }
        }
    });

    const assetsDir = path.join(__dirname, 'assets');
    if (fs.existsSync(assetsDir)) {
        console.log('Assets directory contents:');
        fs.readdirSync(assetsDir).forEach(file => {
            const filePath = path.join(assetsDir, file);
            const stats = fs.statSync(filePath);
            console.log(`  ${file} (${stats.size} bytes)`);
        });
    } else {
        console.log('Assets directory not found at:', assetsDir);
    }
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