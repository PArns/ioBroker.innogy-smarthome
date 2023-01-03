/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const adapter = utils.Adapter('innogy-smarthome');
const helpers = require(`${__dirname}/lib/helpers`)(adapter);
const SmartHome = require('innogy-smarthome-lib');
const fs = require("fs");
const path = require("path");

let smartHome = null;
let checkConnectionTimer = null;
let failbackTimer = null;
let initializedObjects = {};
let objectsInitialized = false;
let storedValues = {};
const deviceStateList = [
    'firmwareVersion',
    'isReachable',
    'lowBattery'
];
let cloudAuthStarted = false;
let Sentry;
const sentryReportedStates = {};

String.prototype.replaceAll = function (search, replacement) {
    const target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

function customStringify(v) {
    const cache = new Set();
    return JSON.stringify(v, function (key, value) {
        if (key === '_requestor' || key === '_smartHome') {
            return;
        }
        if (typeof value === 'object' && value !== null) {
            if (cache.has(value)) {
                // Circular reference found
                try {
                    // If this value does not reference a parent it can be deduped
                    return JSON.parse(JSON.stringify(value));
                }
                catch (err) {
                    // discard key if value cannot be deduped
                    return;
                }
            }
            // Store value in our set
            cache.add(value);
        }
        return value;
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

adapter.on('unload', finalizeSmartHome);
adapter.on('message', onMessage);
adapter.on('stateChange', stateChanged);
adapter.on('ready', initSmartHome);

// ---------------------------------------------------------------------------------------------------------------------

async function onMessage(obj) {
    if (obj) {
        switch (obj.command) {
            case 'startAuth':
                cloudAuthStarted = true;

                adapter.config.useLocalSHC = false;
                await initSmartHome();

                smartHome.startAuthorization(async () => {
                    adapter.log.debug('Authorization complete ... initializing now');
                    smartHome._finalize();
                    await initSmartHome();
                });

                const res = {
                    uri: smartHome.getAuthorizationUri()
                };

                if (obj.callback)
                    adapter.sendTo(obj.from, obj.command, JSON.stringify(res), obj.callback);

                break;
            default:
                adapter.log.warn(`Unknown command: ${obj.command}`);
                break;
        }
    }

    return true;
}

async function initSmartHome() {
    if (!Sentry) {
        if (adapter.supportsFeature && adapter.supportsFeature('PLUGINS')) {
            const sentryInstance = adapter.getPluginInstance('sentry');
            if (sentryInstance) {
                Sentry = sentryInstance.getSentryObject();
            }
        }
    }

    await adapter.setObjectNotExistsAsync("info", {
        "type": "channel",
        "common": {
            "name": "Information"
        }
    });

    await adapter.setObjectNotExistsAsync("info.connection", {
        "type": "state",
        "common": {
            "role": "indicator.connected",
            "name": "API connection ok",
            "type": "boolean",
            "read": true,
            "write": false,
            "def": false
        }
    });

    await adapter.setObjectNotExistsAsync("info.lastRealTimeEventReceived", {
        "type": "state",
        "common": {
            "role": "indicator.datetime",
            "name": "Last realtime event received",
            "type": "string",
            "read": true,
            "write": false,
            "def": ''
        }
    });

    adapter.setState("info.connection", false, true);
    adapter.subscribeStates('*');

    if (checkConnectionTimer) {
        clearInterval(checkConnectionTimer);
        checkConnectionTimer = null;
    }
    checkConnectionTimer = setInterval(() =>{
        adapter.getState("info.connection", (err, connInfo) => {
            if (connInfo && !connInfo.val) {
                adapter.log.warn("Adapter is not connected ... Will recheck in 30 seconds!");

                failbackTimer = setTimeout(() => {
                    failbackTimer = null;
                    adapter.getState("info.connection", (err, connInfo) => {
                        if (connInfo && !connInfo.val) {
                            adapter.log.warn("Adapter is still not connected to the Innogy API, restarting!");
                            smartHome.init();
                        } else {
                            adapter.log.warn("Adapter reconnected!");
                        }
                    });
                }, 1000 * 30);
            }
        });
    }, 1000 * 60 * 5);

    if (adapter.config.useLocalSHC) {
        // eslint-disable-next-line no-control-regex
        if (/[\x00-\x08\x0E-\x1F\x80-\xFF]/.test(adapter.config.localSHCPassword)) {
            adapter.log.error('Password error: Please re-enter the local SHC password in Admin. Stopping');
            if (typeof adapter.disable === 'function') {
                adapter.disable();
            }
            return;
        }
    }

    let dataDir = utils.getAbsoluteInstanceDataDir(adapter);
    let authStorageFile;
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir);
        }
        authStorageFile = path.join(dataDir, 'authorization.json');
    } catch (e) {
        adapter.log.error(`Cannot create data directory: ${dataDir}`);
    }
    try {
        const oldAuthFileLocation = require.resolve('innogy-smarthome-lib/data/auth/authorization.json');
        if (adapter.instance === 0 && !fs.existsSync(authStorageFile) && fs.existsSync(oldAuthFileLocation)) {
            const tokens = fs.readFileSync(oldAuthFileLocation, 'utf8');
            fs.writeFileSync(authStorageFile, tokens, 'utf8');
        }
    } catch (err) {
        // ignore
    }

    const config = {
        redirectHost: 'iobroker-connect.patrick-arns.de',
        redirectBackPort: parseInt(adapter.config.redirectBackPort, 10) || 3000,
        id: '61768662',
        secret: 'no secret',
        debug: adapter.config.debug,

        localShc: adapter.config.localSHCIP,
        localPassword: adapter.config.localSHCPassword,
        localConnection: adapter.config.useLocalSHC,
        shcGeneration: parseInt(adapter.config.shcGeneration, 10),
        authStorageFile
    };

    if (adapter.config.useLocalSHC)
        adapter.log.info(`Trying to use local smarthome connection! SHC generation: ${config.shcGeneration}`);

    smartHome = new SmartHome(config);

    smartHome.on("needsAuthorization",  (auth, error) => {
        adapter.log.warn('Adapter is not configured or needs reauthorization! Please go to the adapter settings and start the authorization');
        smartHome._finalize();
        adapter.log.warn(`DEBUG: ${JSON.stringify(error)}`);
        adapter.setState("info.connection", false, true);
    });

    smartHome.on("needsMobileAccess",  () => {
        adapter.log.warn('You do not have mobile access for the logged in Innogy account! Please purchase mobile access or move ioBroker to the same subnet as the SHC');
        adapter.setState("info.connection", false, true);
    });

    smartHome.on("invalidAuthorization", () =>{
        adapter.log.warn('Unable to connect to local SHC controller! Please ensure your password is correct ...');
        adapter.setState("info.connection", false, true);
    });

    smartHome.on("stateChanged",  (aCapability) => {
        const aDevice = smartHome.getDeviceByCapability(aCapability);

        if (aDevice && aDevice.Capabilities) {
            const devicePath = helpers.getDevicePath(aDevice);
            adapter.log.debug(`Device ${devicePath} changed states!`);

            aDevice.Capabilities.forEach((aCapability) => {
                let capabilityPathPart = ''
                if (aCapability.config) {
                    capabilityPathPart = `.${helpers.cleanDeviceName(aCapability.config.name)}`;
                }
                aCapability.State.forEach((aState) => {
                    const capabilityPath = `${devicePath}${capabilityPathPart}.${helpers.cleanDeviceName(aState.name)}`;
                    if (initializedObjects[capabilityPath]) {
                        adapter.setState(capabilityPath, {val: aState.value, ack: true});
                    } else if (!objectsInitialized) {
                        storedValues[capabilityPath] = aState.value;
                    }
                });
            });
        }
    });

    smartHome.on("initializationComplete", async () => {
        await adapter.setStateAsync("info.connection", true, true);

        if (smartHome.device && smartHome.device.length) {
            adapter.log.info(`Initialization sequence completed: found ${smartHome.device.length} devices`);

            for (const aDevice of smartHome.device) {
                await updateDevice(aDevice);
            }

            helpers.applyRooms();
        } else if (cloudAuthStarted) {
            adapter.log.warn('Adapter will restart to finish the authorization process!');
            typeof adapter.restart === 'function' ? adapter.restart() : adapter.stop();
            return;
        }
        objectsInitialized = true;
        for (const key of Object.keys(storedValues)) {
            adapter.setState(key, storedValues[key], true);
            delete storedValues[key];
        }
    });

    smartHome.on("warning",  (e) => {
        if (typeof e === "string")
            adapter.log.warn(`GOT A WARNING: ${e}`);
        else {
            adapter.log.warn(`GOT A WARNING: ${JSON.stringify(e)}`);

            if (e.stack) {
                adapter.log.warn(`STACK: ${e.stack}`);
            }
        }
    });

    smartHome.on("error",  (e) => {
        if (e && e.code === 'WS_ERR_INVALID_CLOSE_CODE') {
            if (typeof e === "string")
                adapter.log.debug(`GOT AN IGNORED ERROR: ${e}`);
            else {
                adapter.log.debug(`GOT AN IGNORED ERROR: ${JSON.stringify(e)}`);

                if (e.stack) {
                    adapter.log.debug(`STACK: ${e.stack}`);
                }
            }
        } else if (adapter.config.debug) {
            if (typeof e === "string")
                adapter.log.warn(`GOT AN ERROR: ${e}`);
            else {
                adapter.log.warn(`GOT AN ERROR: ${JSON.stringify(e)}`);

                if (e.stack) {
                    adapter.log.warn(`STACK: ${e.stack}`);
                }
            }
        } else {
            if (typeof e === "string")
                adapter.log.warn(`GOT AN ERROR: ${e}`);
            else {
                adapter.log.warn(`GOT AN ERROR: ${JSON.stringify(e)}`);

                if (e.stack) {
                    adapter.log.warn(`STACK: ${e.stack}`);
                }
            }
        }
    });

    smartHome.on("close",  () => {
        adapter.log.debug("SOCKET CONNECTION TO THE INNOGY API WAS CLOSED");
        adapter.setState("info.connection", false, true);
    });

    smartHome.on("open",  () => {
        adapter.log.debug("OPEN");

        adapter.setState("info.connection", true, true);
    });

    smartHome.on("reconnect",  () => {
        adapter.log.debug("RECONNECT");
    });

    smartHome.on("debug",  (debugData) => {
        if (debugData && debugData.type !== "realtime_update_received" && adapter.config.debug)
            adapter.log.debug(`DEBUG EVENT ${JSON.stringify(debugData)}`);

        const now = new Date();
        adapter.setState("info.lastRealTimeEventReceived", now.toISOString(), true);
    });

    smartHome.on('messageCreated', (data) => {
        adapter.config.debug && adapter.log.debug(`MESSAGE CREATED: ${JSON.stringify(data)}`);
        if (data && data.id) {
            let stateName = null;
            let val = null;
            switch (data.type) {
                case 'DeviceLowBattery':
                    stateName = 'lowBattery';
                    val = true;
                    break;
                case 'DeviceUnreachable':
                    stateName = 'isReachable';
                    val = false;
                    break;
            }
            if (!stateName) return;

            if (data.devices) {
                data.devices.forEach((link) => {
                    const dev = smartHome.resolveLink(link);
                    if (dev) {
                        const devicePath = helpers.getDevicePath(dev);
                        const statePath = `${devicePath}.${helpers.cleanDeviceName(stateName)}`;
                        if (initializedObjects[statePath]) {
                            adapter.setState(statePath, val, true);
                        } else if (!objectsInitialized) {
                            storedValues[statePath] = val;
                        }
                    }
                });
            }
        }
    });

    smartHome.on('messageDeleted', (data) => {
        adapter.config.debug && adapter.log.debug(`MESSAGE DELETED: ${JSON.stringify(data)}`);
        if (data && data.id) {
            let stateName = null;
            let val = null;
            switch (data.type) {
                case 'DeviceLowBattery':
                    stateName = 'lowBattery';
                    val = false;
                    break;
                case 'DeviceUnreachable':
                    stateName = 'isReachable';
                    val = true;
                    break;
            }
            if (!stateName) return;

            if (data.devices) {
                data.devices.forEach((link) => {
                    const dev = smartHome.resolveLink(link);
                    if (dev) {
                        const devicePath = helpers.getDevicePath(dev);
                        const statePath = `${devicePath}.${helpers.cleanDeviceName(stateName)}`;
                        if (initializedObjects[statePath]) {
                            adapter.setState(statePath, val, true);
                        } else if (!objectsInitialized) {
                            storedValues[statePath] = val;
                        }
                    }
                });
            }
        }
    });

    smartHome.init();
}

function finalizeSmartHome(callback) {
    try {
        if (checkConnectionTimer) {
            clearInterval(checkConnectionTimer);
            checkConnectionTimer = null;
        }
        if (failbackTimer) {
            clearTimeout(failbackTimer);
            failbackTimer = null;
        }

        if (smartHome)
            smartHome.finalize();

        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
}

async function updateDevice(aDevice) {
    if (aDevice) {
        const devicePath = helpers.getDevicePath(aDevice);
        const room = helpers.getRoomNameForDevice(aDevice);

        const hasCapStates = function (aDevice) {
            if (aDevice.State && aDevice.State.length) {
                for (const aState of aDevice.State) {
                    if (deviceStateList.includes(aState.name)) {
                        return true;
                    }
                }
            }

            if (aDevice.Capabilities && aDevice.Capabilities) {
                for (const aCapability of aDevice.Capabilities) {
                    if (aCapability.State && aCapability.State.length) {
                        return true;
                    }
                }
            }

            return false;
        };

        if (hasCapStates(aDevice)) {

            adapter.log.debug(`Processing device -> ${devicePath}: "${aDevice.getName()}"`);
            if (adapter.config.debug) {
                adapter.log.debug(`Device: ${customStringify(aDevice)}`);
            } else {
                adapter.log.debug(`Device State: ${customStringify(aDevice.State)}`);
            }

            await adapter.extendObjectAsync(devicePath, {
                type: "device",
                common: {
                    name: aDevice.getName()
                },
                native: {
                    id: aDevice.id
                }
            });

            const lowBatName = `${devicePath}.${helpers.cleanDeviceName('lowBattery')}`;
            await adapter.extendObjectAsync(lowBatName, {
                type: "state",
                common: {
                    name: helpers.capitalize('lowBattery'),
                    type: "boolean",
                    role: "indicator.lowbat",
                    read: true,
                    write: false
                }
            });
            await adapter.setState(lowBatName, false, true);
            initializedObjects[lowBatName] = true;

            if (aDevice.State && aDevice.State.length) {

                for (const aState of aDevice.State) {
                    if (deviceStateList.includes(aState.name)) {
                        const statePath = `${devicePath}.${helpers.cleanDeviceName(aState.name)}`;

                        adapter.log.debug(`Updating device state ${statePath}: ${JSON.stringify(aState)}`);

                        await adapter.extendObjectAsync(statePath, {
                            type: "state",
                            common: helpers.merge_options({name: helpers.capitalize(aState.name)}, getCommonForState(aState, 'DeviceState'))
                        });
                        initializedObjects[statePath] = true;

                        await adapter.setStateAsync(statePath, {val: aState.value, ack: true});
                        helpers.addCapabilityToRoom(room, statePath);
                    }
                }
            }

            if (aDevice.Capabilities && aDevice.Capabilities) {
                for (const aCapability of aDevice.Capabilities) {
                    let capabilityPathPart = '';
                    if (aCapability.State.length && aCapability.config) {
                        capabilityPathPart = `.${helpers.cleanDeviceName(aCapability.config.name)}`;
                        await adapter.extendObjectAsync(`${devicePath}${capabilityPathPart}`, {
                            type: "channel",
                            common: {
                                name: aCapability.config.name
                            },
                            native: {
                                id: aCapability.id
                            }
                        });
                    }
                    for (const aState of aCapability.State) {
                        const capabilityPath = `${devicePath}${capabilityPathPart}.${helpers.cleanDeviceName(aState.name)}`;

                        adapter.log.debug(`Updating device capability ${capabilityPath}: ${JSON.stringify(aState)}`);

                        await adapter.extendObjectAsync(capabilityPath, {
                            type: "state",
                            common: helpers.merge_options({name: helpers.capitalize(aState.name)}, getCommonForState(aState, aCapability.config ? aCapability.config.name : 'DeviceCapability')),
                            native: {
                                id: aCapability.id,
                                name: aState.name
                            }
                        });
                        initializedObjects[capabilityPath] = true;

                        await adapter.setStateAsync(capabilityPath, {val: aState.value, ack: true});
                        helpers.addCapabilityToRoom(room, capabilityPath);
                    }
                }
            }
        }
    }
}

function stateChanged(id, state) {
    if (state) {
        adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    }
    if (state && !state.ack) {
        adapter.getForeignObject(id, async (err, obj) => {
            if (err) {
                adapter.log.error(err.message);
            } else {
                if (obj && obj.native) {
                    const capability = smartHome.getCapabilityById(obj.native.id);

                    if (capability) {
                        if (obj.common.write) {
                            adapter.log.debug(`Setting capability ${capability.id}/${obj.common.name} to ${state.val}`);
                            const capabilityStateName = obj.native.name || obj.common.name;
                            try {
                                await capability.setState(state.val, capabilityStateName);
                            } catch (e) {
                                adapter.log.error(`SET STATE ${id} for ${capabilityStateName} ERR ${e ? e.error || e.message :  e}`);
                            }
                        } else {
                            await updateDevice(smartHome.resolveLink(capability.Device));
                        }
                    }
                }
            }
        });
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

function getCommonForState(aState, context) {
    const res = {};

    switch (aState.name) {
        // Device States
        case 'firmwareVersion':
            res.type = 'string';
            res.role = 'value';
            res.read = true;
            res.write = false;
            break;

        case 'isReachable':
            res.type = 'boolean';
            res.role = 'indicator.reachable';
            res.read = true;
            res.write = false;
            break;

        // -- SHC --
        case "nextSunrise":
        case "nextSunset":
        case "nextTimeEvent":
            res.type = "string";
            res.role = "date";
            res.read = true;
            res.write = false;
            break;

        case "isDay":
            res.type = "boolean";
            res.role = "indicator";
            res.read = true;
            res.write = false;
            break;

        case "value":
        case "onState":
        case "onOff":
            res.type = "boolean";
            res.role = "switch";
            res.read = true;
            res.write = true;
            break;

        case "remainingQuota":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        // -- Thermostat --
        case "pointTemperature":
        case "setpointTemperature":
            res.type = "number";
            res.role = "level.temperature";
            res.read = true;
            res.write = true;
            res.unit = "°C";
            res.min = 6;
            res.max = 30;
            break;

        case "windowReductionActive":
            res.type = "boolean";
            res.role = "switch";
            res.read = true;
            res.write = true;
            break;

        case "operationMode":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = true;
            res.states = {
                "Auto": "Automatic",
                "Manu": "Manual"
            };
            break;

        case "temperature":
            res.type = "number";
            res.role = "value.temperature";
            res.read = true;
            res.write = false;
            res.unit = "°C";
            break;

        case "frostWarning":
            res.type = "boolean";
            res.role = "switch";
            res.read = true;
            res.write = true;
            break;

        case "humidity":
            res.type = "number";
            res.role = "value.humidity";
            res.read = true;
            res.write = false;
            res.unit = "%";
            res.min = 0;
            res.max = 100;
            break;

        case "moldWarning":
            res.type = "boolean";
            res.role = "switch";
            res.read = true;
            res.write = true;
            break;

        // -- Wifi ---
        case "ssid":
            res.type = "string";
            res.role = "text";
            res.read = true;
            res.write = false;
            break;

        case "signalStrength":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "dBm";
            res.min = -100;
            res.max = 0;
            break;

        // -- BEWEGUNGSMELDER --
        case "motionDetected":
            res.type = "boolean";
            res.role = "sensor.motion";
            res.read = true;
            res.write = false;
            break;

        case "motionDetectedCount":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "luminance":
            res.type = "number";
            res.role = "value.brightness";
            res.read = true;
            res.write = false;
            res.unit = "%";
            res.min = 0;
            res.max = 100;
            break;

        // -- Tamper Detection Sensor --
        case "tamperDetected":
            res.type = "boolean";
            res.role = "sensor";
            res.read = true;
            res.write = false;
            break;

        // -- Smoke Detector --
        case "smokeDetected":
            res.type = "boolean";
            res.role = "sensor.alarm.fire";
            res.read = true;
            res.write = false;
            break;

        // -- WANDSENDER --
        case "lastKeyPressCounter":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "lastPressedButtonIndex":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        // -- TÜRSENSOR --
        case "isOpen":
            res.type = "boolean";
            res.role = "sensor.window";
            res.read = true;
            res.write = true;
            res.states = {
                true: "Open",
                false: "Closed"
            };
            break;

        // -- NETATMO --
        case "carbonDioxideLevel":
            res.type = "number";
            res.role = "level.co2";
            res.read = true;
            res.write = false;
            res.unit = "ppm";
            break;

        case "noiseLevel":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "dB";
            break;

        case "rainfall":
            res.type = "number";
            res.role = "value.precipitation";
            res.read = true;
            res.write = false;
            res.unit = "mm";
            break;

        case "atmosphericPressure":
            res.type = "number";
            res.role = "value.pressure";
            res.read = true;
            res.write = false;
            res.unit = "mb";
            break;

        case "windDirection":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "gustDirection":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "gustStrength":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "windStrength":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        // -- POWERCONTROL --
        case "maximumGenerationPower":
            res.type = "number";
            res.role = "value.power.generation";
            res.read = true;
            res.write = false;
            res.unit = "W";
            break;

        case "powerInWatt":
            res.type = "number";
            res.role = "value.power.consumption";
            res.read = true;
            res.write = false;
            res.unit = "W";
            break;

        case "energyPerMonthInKWh":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "energyPerMonthInEuro":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "Eur";
            break;

        case "energyPerDayInKWh":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "energyPerDayInEuro":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "Eur";
            break;

        case "twoWayPower":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "powerMedian":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "totalEnergy":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "powerConsumptionWatt":
            res.type = "number";
            res.role = "value.power.consumption";
            res.read = true;
            res.write = false;
            res.unit = "W";
            break;

        case "energyConsumptionDayKwh":
        case "energyConsumptionDayKWh":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "W";
            break;

        case "energyConsumptionDayCurrency":
        case "energyConsumptionDayEuro":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "Eur";
            break;

        case "energyConsumptionMonthCurrency":
        case "energyConsumptionMonthEuro":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "Eur";
            break;

        case "energyConsumptionTotalCurrency":
        case "energyConsumptionTotalEuro":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "Eur";
            break;

        case "energyConsumptionTotalKwh":
        case "energyConsumptionTotalKWh":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "predictedEnergyConsumptionDayKwh":
        case "predictedEnergyConsumptionDayKWh":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "predictedEnergyConsumptionMonthKwh":
        case "predictedEnergyConsumptionMonthKWh":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "predictedEnergyConsumptionYearKwh":
        case "predictedEnergyConsumptionYearKWh":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "predictedEnergyConsumptionDayCurrency":
        case "predictedEnergyConsumptionDayEuro":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "Eur";
            break;

        case "predictedEnergyConsumptionMonthCurrency":
        case "predictedEnergyConsumptionMonthEuro":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "Eur";
            break;

        case "predictedEnergyConsumptionYearCurrency":
        case "predictedEnergyConsumptionYearEuro":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "Eur";
            break;

        case "absoluteEnergyConsumption":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "energyConsumptionMonthKwh":
        case "energyConsumptionMonthKWh":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        // -- HUE --
        case "brightness":
            res.type = "number";
            res.role = "level.dimmer";
            res.read = true;
            res.write = true;
            res.min = 0;
            res.max = 100;
            res.unit = "%";
            break;

        case "blink":
            res.type = "boolean";
            res.role = "switch";
            res.read = true;
            res.write = true;
            break;

        case "colorTemperature":
            res.type = "number";
            res.role = "level.color.temperature";
            res.read = true;
            res.write = true;
            break;

        case "hue":
            res.type = "number";
            res.role = "level.color.hue";
            res.read = true;
            res.write = true;
            break;

        case "dimLevel":
            res.type = "number";
            res.role = "level.dimmer";
            res.read = true;
            res.write = true;
            res.min = 0;
            res.max = 100;
            res.unit = "%";
            break;

        case "saturation":
            res.type = "number";
            res.role = "level.color.saturation";
            res.read = true;
            res.write = true;
            break;

        case "dynamicEffect":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = true;
            break;

        case "colorMode":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = true;
            break;

        // -- Rolladen --
        case "ShutterLevel":
        case "shutterLevel":
            res.type = "number";
            res.role = "level";
            res.read = true;
            res.write = true;
            break;

        // -- Feuermelder --
        case "isOn":
            res.type = "boolean";
            res.role = "sensor.alarm";
            res.read = true;
            res.write = true;
            break;

        case "isSmokeAlarm":
            res.type = "boolean";
            res.role = "sensor.alarm";
            res.read = true;
            res.write = false;
            break;

        case "activeChannel":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = false;
            break;

        // HTTP
        case "isSending":
            res.type = "boolean";
            res.role = "indicator";
            res.read = true;
            res.write = false;
            break;

        case "HTTPResponseStatus":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = false;
            break;

        // Kamera
        case "isCapturing":
            res.type = "boolean";
            res.role = "indicator";
            res.read = true;
            res.write = false;
            break;

        // WakeOnLan
        case "executionCount":
            res.type = "number";
            res.role = "state";
            res.read = true;
            res.write = false;
            break;

        // Mähroboter
        case "errorDescription":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = false;
            break;

        case "chargingCurrent":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            res.unit = 'W';
            break;

        case "chargingCycles":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "batteryLevel":
            res.type = "number";
            res.role = "value.battery ";
            res.read = true;
            res.write = false;
            res.unit = '%';
            break;

        case "situationFlags":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = false;
            break;

        case "operationTimeBlade":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "operationTimeWR":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "operationTimeWL":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "bladeServiceTime":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "totalMowingTime":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "mowingCycles":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "operatingTime":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "operatingTimeLastWeek":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "operatingTimeCurrentWeek":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "subStatus":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = false;
            break;

        case "mowerStatus":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = false;
            break;

        case "tiltSlope":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "remainingOperationTime":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "nextOperationStartTime":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "rainDelay":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "rainSensor":
            res.type = "boolean";
            res.role = "indicator";
            res.read = true;
            res.write = false;
            break;

        case "ecoMode":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "cuttingHeight":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "action":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = true;
            break;

        case "lightState":
            res.type = "boolean";
            res.role = "indicator";
            res.read = true;
            res.write = true;
            break;

        case "doorState":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = false;
            break;

        case "lockState":
            res.type = "boolean";
            res.role = "sensor.lock ";
            res.read = true;
            res.write = false;
            break;

        // ISS2
        case "index":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "keyPressCounter":
            res.type = "number";
            res.role = "value";
            res.read = true;
            res.write = false;
            break;

        case "type":
            res.type = "string";
            res.role = "state";
            res.read = true;
            res.write = false;
            break;

        default:

            if (Sentry && !sentryReportedStates[`${context}/${aState.name}`]) {
                Sentry.withScope(scope => {
                    scope.setLevel('info');
                    scope.setExtra("state", JSON.stringify(aState));
                    Sentry.captureMessage(`State ${context}/${aState.name}`, 'info');
                });
                sentryReportedStates[`${context}/${aState.name}`] = true;
            } else if (adapter.config.debug) {
                adapter.log.warn(`Unknown state (please report to dev):${context}/${aState.name} ${JSON.stringify(aState)}`);
            }

            res.type = typeof aState !== 'object' ? typeof aState !== 'object' : "mixed";
            res.role = "state";
            res.read = true;
            res.write = true;
            break;
    }

    return res;
}
