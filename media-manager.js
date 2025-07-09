const { globalShortcut, systemPreferences, nativeImage } = require('electron');
const { nativeTheme } = require('electron');
const path = require('path');

class MediaManager {
    constructor(mainWindow, mediaState) {
        this.mainWindow = mainWindow;
        this.mediaState = mediaState;
        this.platform = process.platform;
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) return;

        console.log(`Initializing media controls for ${this.platform}`);

        if (this.platform === 'win32') {
            this.setupWindowsControls();
        } else if (this.platform === 'darwin') {
            this.setupMacControls();
        }

        this.setupGlobalShortcuts();
        this.initialized = true;
    }

    setupWindowsControls() {
        // Windows thumbnail toolbar setup
        if (this.mainWindow && this.mainWindow.setThumbarButtons) {
            this.updateThumbnailToolbar();
        }
    }

    setupMacControls() {
        // macOS system media key registration
        console.log('Setting up macOS media controls');

        // Subscribe to system notifications
        if (systemPreferences && systemPreferences.subscribeNotification) {
            systemPreferences.subscribeNotification('com.apple.audio.session-interrupted', () => {
                console.log('Audio session interrupted');
                this.sendMediaCommand('pause');
            });

            systemPreferences.subscribeNotification('com.apple.screenIsLocked', () => {
                console.log('Screen locked - maintaining audio session');
            });
        }
    }

    setupGlobalShortcuts() {
        // Clear existing shortcuts
        globalShortcut.unregisterAll();

        // Register media key shortcuts
        const shortcuts = {
            'MediaPlayPause': () => this.sendMediaCommand('playpause'),
            'MediaPreviousTrack': () => this.sendMediaCommand('previous'),
            'MediaNextTrack': () => this.sendMediaCommand('next'),
            'MediaStop': () => this.sendMediaCommand('pause')
        };

        // Additional shortcuts for different keyboard layouts
        const additionalShortcuts = {
            'F8': () => this.sendMediaCommand('playpause'),
            'F7': () => this.sendMediaCommand('previous'),
            'F9': () => this.sendMediaCommand('next')
        };

        // Register shortcuts with error handling
        Object.entries(shortcuts).forEach(([key, handler]) => {
            try {
                const registered = globalShortcut.register(key, handler);
                console.log(`${key} shortcut registered:`, registered);
            } catch (error) {
                console.warn(`Failed to register ${key}:`, error.message);
            }
        });

        // Register additional shortcuts (F-keys)
        Object.entries(additionalShortcuts).forEach(([key, handler]) => {
            try {
                const registered = globalShortcut.register(key, handler);
                console.log(`${key} shortcut registered:`, registered);
            } catch (error) {
                console.warn(`Failed to register ${key}:`, error.message);
            }
        });
    }

    sendMediaCommand(command) {
        console.log(`Sending media command: ${command}`);

        // For next/previous commands, immediately set playing state since SoundCloud auto-plays
        if (command === 'next' || command === 'previous') {
            this.mediaState.isPlaying = true;
            this.updateControls(); // Update toolbar immediately
            console.log('Set state to playing for next/previous command');
        }

        // Try multiple approaches for maximum compatibility
        this.tryKeyboardShortcut(command)
            .then(success => {
                if (!success) {
                    console.log('Keyboard shortcut failed, trying DOM manipulation');
                    return this.tryDOMManipulation(command);
                }
                return success;
            })
            .then(success => {
                if (!success) {
                    console.log('DOM manipulation failed, trying media session API');
                    return this.tryMediaSessionAPI(command);
                }
                return success;
            })
            .then(success => {
                console.log(`Command ${command} execution result:`, success);
                
                // For next/previous, verify state multiple times with different delays
                if ((command === 'next' || command === 'previous') && success) {
                    // First check after 500ms
                    setTimeout(() => {
                        console.log('First verification attempt (500ms)');
                        this.verifyPlaybackState();
                    }, 500);
                    
                    // Second check after 1.5s
                    setTimeout(() => {
                        console.log('Second verification attempt (1.5s)');
                        this.verifyPlaybackState();
                    }, 1500);
                    
                    // Third check after 3s
                    setTimeout(() => {
                        console.log('Third verification attempt (3s)');
                        this.verifyPlaybackState();
                    }, 3000);
                }
            })
            .catch(error => {
                console.error('All media command methods failed:', error);
            });
    }

    // Function to verify the actual playback state after next/previous
    verifyPlaybackState() {
        if (!this.mainWindow || !this.mainWindow.webContents) return;

        const stateScript = `
        (function() {
            try {
                let isPlaying = false;
                let debugInfo = {
                    methods: [],
                    elements: [],
                    finalState: false
                };

                // Method 1: Check play/pause button
                const playSelectors = [
                    '.playControl',
                    '.playControls__play',
                    '.playback__play',
                    '.playControls__control.playControls__play',
                    '[title*="Play"]',
                    '[title*="Pause"]',
                    '.sc-button-play',
                    '.sc-button-pause',
                    '.playButton',
                    '.playControls button[title]'
                ];

                for (const selector of playSelectors) {
                    const button = document.querySelector(selector);
                    if (button) {
                        const title = button.title || button.getAttribute('aria-label') || '';
                        const className = button.className || '';
                        
                        debugInfo.elements.push({
                            selector: selector,
                            title: title,
                            className: className,
                            visible: button.offsetParent !== null
                        });

                        if (title.toLowerCase().includes('pause')) {
                            isPlaying = true;
                            debugInfo.methods.push('button-title-pause');
                            break;
                        }
                    }
                }

                // Method 2: Check for playing class indicators
                const playingElements = document.querySelectorAll([
                    '.playing',
                    '.isPlaying',
                    '[class*="playing"]',
                    '[class*="Playing"]',
                    '.m-playing'
                ].join(','));

                if (playingElements.length > 0) {
                    isPlaying = true;
                    debugInfo.methods.push('playing-class');
                }

                // Method 3: Check waveform/progress indicators
                const progressElements = [
                    '.playbackSoundBadge__progress',
                    '.playbackTimeline__progressWrapper',
                    '.waveform__layer',
                    '.progressBar',
                    '.playbackTimeline__progressHandle'
                ];

                for (const selector of progressElements) {
                    const element = document.querySelector(selector);
                    if (element) {
                        const computedStyle = window.getComputedStyle(element);
                        if (computedStyle.animationPlayState === 'running' || 
                            computedStyle.animationName !== 'none') {
                            isPlaying = true;
                            debugInfo.methods.push('animation-running');
                            break;
                        }
                    }
                }

                // Method 4: Check audio element (if accessible)
                const audioElements = document.querySelectorAll('audio');
                for (const audio of audioElements) {
                    if (!audio.paused && !audio.ended) {
                        isPlaying = true;
                        debugInfo.methods.push('audio-element');
                        break;
                    }
                }

                // Method 5: Check for SoundCloud-specific indicators
                const soundcloudIndicators = [
                    '.playbackSoundBadge',
                    '.playbackTimeline',
                    '.playControls',
                    '.playback'
                ];

                for (const selector of soundcloudIndicators) {
                    const element = document.querySelector(selector);
                    if (element) {
                        // Check if any child has playing-related classes
                        const hasPlayingChild = element.querySelector('.playing, [class*="playing"], [class*="Playing"]');
                        if (hasPlayingChild) {
                            isPlaying = true;
                            debugInfo.methods.push('soundcloud-indicator');
                            break;
                        }
                    }
                }

                // Method 6: Check document body for global playing state
                const body = document.body;
                if (body) {
                    const bodyClasses = body.className.toLowerCase();
                    if (bodyClasses.includes('playing') || bodyClasses.includes('isplaying')) {
                        isPlaying = true;
                        debugInfo.methods.push('body-class');
                    }
                }

                debugInfo.finalState = isPlaying;

                return { 
                    isPlaying: isPlaying,
                    debug: debugInfo,
                    timestamp: Date.now(),
                    url: window.location.href
                };
            } catch (error) {
                return { 
                    isPlaying: true, // Default to playing on error
                    error: error.message,
                    timestamp: Date.now()
                };
            }
        })();
    `;

    this.mainWindow.webContents.executeJavaScript(stateScript)
        .then(result => {
            console.log('=== PLAYBACK STATE VERIFICATION ===');
            console.log('Result:', result);
            
            if (result && typeof result.isPlaying === 'boolean') {
                const previousState = this.mediaState.isPlaying;
                this.mediaState.isPlaying = result.isPlaying;
                
                console.log(`State change: ${previousState} → ${result.isPlaying}`);
                console.log('Detection methods used:', result.debug?.methods || 'none');
                
                if (result.debug?.elements) {
                    console.log('Found elements:', result.debug.elements);
                }
                
                this.updateControls();
            } else {
                console.log('No valid playback state detected, keeping current state');
            }
        })
        .catch(error => {
            console.error('Error verifying playback state:', error);
        });
}

    tryKeyboardShortcut(command) {
        return new Promise((resolve) => {
            const keyMap = {
                'playpause': { key: 'Space', modifiers: [] },
                'previous': { key: 'Left', modifiers: ['shift'] },
                'next': { key: 'Right', modifiers: ['shift'] },
                'pause': { key: 'Space', modifiers: [] }
            };

            const keyConfig = keyMap[command];
            if (!keyConfig || !this.mainWindow) {
                resolve(false);
                return;
            }

            try {
                // Send key down
                this.mainWindow.webContents.sendInputEvent({
                    type: 'keyDown',
                    keyCode: keyConfig.key,
                    modifiers: keyConfig.modifiers
                });

                // Send key up
                setTimeout(() => {
                    this.mainWindow.webContents.sendInputEvent({
                        type: 'keyUp',
                        keyCode: keyConfig.key,
                        modifiers: keyConfig.modifiers
                    });
                }, 50);

                // Update state for play/pause only (next/previous handled in sendMediaCommand)
                if (command === 'playpause') {
                    this.mediaState.isPlaying = !this.mediaState.isPlaying;
                    setTimeout(() => this.updateControls(), 200);
                }

                resolve(true);
            } catch (error) {
                console.error('Keyboard shortcut error:', error);
                resolve(false);
            }
        });
    }

    tryDOMManipulation(command) {
        return new Promise((resolve) => {
            if (!this.mainWindow) {
                resolve(false);
                return;
            }

            const script = this.generateDOMScript(command);

            this.mainWindow.webContents.executeJavaScript(script)
                .then(result => {
                    console.log('DOM manipulation result:', result);

                    if (result && result.success) {
                        // For play/pause, use the detected state from the DOM
                        if (command === 'playpause' && result.isPlaying !== undefined) {
                            this.mediaState.isPlaying = result.isPlaying;
                            setTimeout(() => this.updateControls(), 200);
                        }
                        // For next/previous, state is already set in sendMediaCommand
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                })
                .catch(error => {
                    console.error('DOM manipulation error:', error);
                    resolve(false);
                });
        });
    }

    generateDOMScript(command) {
        const selectorMaps = {
            'playpause': [
                '.playControl',
                '.playControls__play',
                '.playback__play',
                '.playControls__control.playControls__play',
                '[title*="Play"]',
                '[title*="Pause"]',
                '.sc-button-play',
                '.sc-button-pause'
            ],
            'previous': [
                '.playControls__prev',
                '.playback__prev',
                '.skipControl__previous',
                '[title*="Previous"]',
                '.playControls__control:first-child',
                '.sc-button-prev'
            ],
            'next': [
                '.playControls__next',
                '.playback__next',
                '.skipControl__next',
                '[title*="Next"]',
                '.playControls__control:last-child',
                '.sc-button-next'
            ]
        };

        const selectors = selectorMaps[command] || [];

        return `
            (function() {
                try {
                    const selectors = ${JSON.stringify(selectors)};
                    
                    for (const selector of selectors) {
                        const button = document.querySelector(selector);
                        if (button && !button.disabled && button.offsetParent !== null) {
                            console.log('Found button with selector:', selector);
                            button.click();
                            
                            // Get current state (mainly for play/pause)
                            const playButton = document.querySelector('.playControl, .playControls__play, [title*="Play"], [title*="Pause"]');
                            const isPlaying = playButton ? playButton.title.toLowerCase().includes('pause') : false;
                            
                            return { 
                                success: true, 
                                method: 'DOM',
                                selector: selector,
                                isPlaying: isPlaying
                            };
                        }
                    }
                    
                    return { success: false, method: 'DOM', error: 'No valid button found' };
                } catch (error) {
                    return { success: false, method: 'DOM', error: error.message };
                }
            })();
        `;
    }

    tryMediaSessionAPI(command) {
        return new Promise((resolve) => {
            if (!this.mainWindow) {
                resolve(false);
                return;
            }

            const script = `
                (function() {
                    try {
                        if ('mediaSession' in navigator) {
                            const actionMap = {
                                'playpause': navigator.mediaSession.playbackState === 'playing' ? 'pause' : 'play',
                                'previous': 'previoustrack',
                                'next': 'nexttrack',
                                'pause': 'pause'
                            };
                            
                            const action = actionMap['${command}'];
                            if (action) {
                                const event = new CustomEvent('mediasessionaction', { 
                                    detail: { action: action } 
                                });
                                document.dispatchEvent(event);
                                
                                return { success: true, method: 'MediaSession', action: action };
                            }
                        }
                        
                        return { success: false, method: 'MediaSession', error: 'MediaSession not available' };
                    } catch (error) {
                        return { success: false, method: 'MediaSession', error: error.message };
                    }
                })();
            `;

            this.mainWindow.webContents.executeJavaScript(script)
                .then(result => {
                    console.log('MediaSession result:', result);
                    resolve(result && result.success);
                })
                .catch(error => {
                    console.error('MediaSession error:', error);
                    resolve(false);
                });
        });
    }

    updateControls() {
        if (this.platform === 'win32') {
            this.updateThumbnailToolbar();
        }
        // macOS updates happen automatically through system integration
    }

    updateThumbnailToolbar() {
        if (!this.mainWindow || !this.mainWindow.setThumbarButtons) return;

        const iconTheme = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';

        try {
            const playIcon = nativeImage.createFromPath(path.join(__dirname, 'icons', iconTheme, 'ic_fluent_play_16_filled.png'));
            const pauseIcon = nativeImage.createFromPath(path.join(__dirname, 'icons', iconTheme, 'ic_fluent_pause_16_filled.png'));
            const nextIcon = nativeImage.createFromPath(path.join(__dirname, 'icons', iconTheme, 'ic_fluent_next_16_filled.png'));
            const prevIcon = nativeImage.createFromPath(path.join(__dirname, 'icons', iconTheme, 'ic_fluent_previous_16_filled.png'));

            const buttons = [
                {
                    tooltip: 'Previous Track',
                    icon: prevIcon,
                    flags: this.mediaState.canGoPrevious ? [] : ['disabled'],
                    click: () => this.sendMediaCommand('previous')
                },
                {
                    tooltip: this.mediaState.isPlaying ? 'Pause' : 'Play',
                    icon: this.mediaState.isPlaying ? pauseIcon : playIcon,
                    click: () => this.sendMediaCommand('playpause')
                },
                {
                    tooltip: 'Next Track',
                    icon: nextIcon,
                    flags: this.mediaState.canGoNext ? [] : ['disabled'],
                    click: () => this.sendMediaCommand('next')
                }
            ];

            this.mainWindow.setThumbarButtons(buttons);
        } catch (error) {
            console.error('Error updating thumbnail toolbar:', error);
        }
    }

    cleanup() {
        console.log('Cleaning up media controls');
        globalShortcut.unregisterAll();
        this.initialized = false;
    }

    debugCurrentState() {
        if (!this.mainWindow || !this.mainWindow.webContents) return;

        const debugScript = `
        (function() {
            console.log('=== SOUNDCLOUD STATE DEBUG ===');
            
            // Log all potential play buttons
            const playSelectors = [
                '.playControl',
                '.playControls__play',
                '.playback__play',
                '.playControls__control.playControls__play',
                '[title*="Play"]',
                '[title*="Pause"]',
                '.sc-button-play',
                '.sc-button-pause',
                '.playButton'
            ];
            
            playSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    elements.forEach((el, index) => {
                        console.log(\`\${selector} [\${index}]:\`, {
                            title: el.title,
                            ariaLabel: el.getAttribute('aria-label'),
                            className: el.className,
                            visible: el.offsetParent !== null,
                            innerHTML: el.innerHTML.substring(0, 100)
                        });
                    });
                }
            });
            
            // Log audio elements
            const audioElements = document.querySelectorAll('audio');
            console.log('Audio elements:', audioElements.length);
            audioElements.forEach((audio, index) => {
                console.log(\`Audio [\${index}]:\`, {
                    paused: audio.paused,
                    ended: audio.ended,
                    currentTime: audio.currentTime,
                    duration: audio.duration,
                    src: audio.src.substring(0, 100)
                });
            });
            
            // Log playing classes
            const playingElements = document.querySelectorAll('.playing, [class*="playing"], [class*="Playing"]');
            console.log('Playing elements:', playingElements.length);
            
            return 'Debug info logged to console';
        })();
    `;

        this.mainWindow.webContents.executeJavaScript(debugScript)
            .then(result => {
                console.log('Debug script executed:', result);
            })
            .catch(error => {
                console.error('Debug script error:', error);
            });
    }
}

module.exports = MediaManager;