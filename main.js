/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var utils = require('@iobroker/adapter-core'); // Get common adapter utils
var adapter = utils.Adapter('innogy-smarthome');
var helpers = require(__dirname + '/lib/helpers')(adapter);
var SmartHome = require('innogy-smarthome-lib');

var smartHome = null;
var checkConnectionTimer = null;

String.prototype.replaceAll = function (search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

adapter.on('unload', finalizeSmartHome);
adapter.on('message', onMessage);
adapter.on('objectChange', stateChanged);
adapter.on('stateChange', stateChanged);
adapter.on('ready', initSmartHome);

// ---------------------------------------------------------------------------------------------------------------------

function onMessage(obj) {
    if (obj) {
        switch (obj.command) {
            case 'startAuth':

                adapter.config.useLocalSHC = false;
                initSmartHome();

                smartHome.startAuthorization(function () {
                    smartHome.init();
                });

                var res = {
                    uri: smartHome.getAuthorizationUri()
                };

                if (obj.callback)
                    adapter.sendTo(obj.from, obj.command, JSON.stringify(res), obj.callback);

                break;
            default:
                adapter.log.warn("Unknown command: " + obj.command);
                break;
        }
    }

    return true;
}

function initSmartHome() {
    adapter.setObjectNotExists("info", {
        "type": "channel",
        "common": {
            "name": "Information"
        }
    });

    adapter.setObjectNotExists("info.connection", {
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

    adapter.setObjectNotExists("info.lastRealTimeEventReceived", {
        "type": "state",
        "common": {
            "role": "indicator.datetime",
            "name": "Last realtime event received",
            "type": "string",
            "read": true,
            "write": false,
            "def": false
        }
    });

    adapter.setState("info.connection", false, true);
    adapter.subscribeStates('*');

    checkConnectionTimer = setInterval(function () {
        adapter.getState("info.connection", function (err, connInfo) {
            if (connInfo && !connInfo.val) {
                adapter.log.warn("Adapter is not connected ... Will recheck in 30 seconds!");

                setTimeout(function () {
                    adapter.getState("info.connection", function (err, connInfo) {
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

    const config = {
        redirectHost: 'iobroker-connect.patrick-arns.de',
        id: '61768662',
        secret: 'no secret',
        debug: adapter.config.debug,

        localShc: adapter.config.localSHCIP,
        localPassword: adapter.config.localSHCPassword,
        localConnection: adapter.config.useLocalSHC
    };

    if (adapter.config.useLocalSHC)
        adapter.log.info("Trying to use local smarthome connection!");

    smartHome = new SmartHome(config);

    smartHome.on("needsAuthorization", function (error) {
        adapter.log.warn('Adapter is not configured or needs reauthorization! Please go to the adapter settings and start the authorization');
        adapter.log.warn("DEBUG: " + JSON.stringify(error));
        adapter.setState("info.connection", false, true);
    });

    smartHome.on("needsMobileAccess", function () {
        adapter.log.warn('You do not have mobile access for the logged in Innogy account! Please purchase mobile access or move ioBroker to the same subnet as the SHC');
        adapter.setState("info.connection", false, true);
    });

    smartHome.on("invalidAuthorization", function() {
        adapter.log.warn('Unable to connect to local SHC controller! Please ensure your password is correct ...');
        adapter.setState("info.connection", false, true);
    });

    smartHome.on("stateChanged", function (aCapability) {
        var aDevice = smartHome.getDeviceByCapability(aCapability);

        if (aDevice && aDevice.Capabilities) {
            var devicePath = helpers.getDevicePath(aDevice);

            aDevice.Capabilities.forEach(function (aCapability) {
                aCapability.State.forEach(function (aState) {
                    var capabilityPath = devicePath + "." + helpers.cleanDeviceName(aState.name);
                    adapter.setState(capabilityPath, {val: aState.value, ack: true});
                });
            });
        }
    });

    smartHome.on("initializationComplete", function () {
        adapter.setState("info.connection", true, true);

        if (smartHome.device && smartHome.device.length) {
            adapter.log.info('Initialization sequence completed: found ' + smartHome.device.length + ' devices');

            smartHome.device.forEach(function (aDevice) {
                updateDevice(aDevice);
            });

            helpers.applyRooms();
        }
    });

    smartHome.on("warning", function (e) {
        if (typeof e === "string")
            adapter.log.warn("GOT A WARNING:" + e);
        else {
            adapter.log.warn("GOT A WARNING:" + JSON.stringify(e));

            if (e.stack) {
                adapter.log.warn("STACK:" + e.stack);
            }
        }
    });

    smartHome.on("error", function (e) {
        if (adapter.config.debug) {
            if (typeof e === "string")
                adapter.log.error("GOT AN ERROR:" + e);
            else {
                adapter.log.error("GOT AN ERROR:" + JSON.stringify(e));

                if (e.stack) {
                    adapter.log.error("STACK:" + e.stack);
                }
            }
        }
    });

    smartHome.on("close", function (e) {
        adapter.log.debug("SOCKET CONNECTION TO THE INNOGY API WAS CLOSED");
        adapter.setState("info.connection", false, true);
    });

    smartHome.on("open", function () {
        adapter.log.debug("OPEN");

        adapter.setState("info.connection", true, true);
    });

    smartHome.on("reconnect", function () {
        adapter.log.debug("RECONNECT");
    });

    smartHome.on("debug", function (debugData) {
        if (debugData && debugData.type !== "realtime_update_received")
            adapter.log.debug("DEBUG EVENT " + JSON.stringify(debugData));

        var now = new Date();
        adapter.setState("info.lastRealTimeEventReceived", now.toISOString(), true);
    });

    smartHome.init();
}

function finalizeSmartHome(callback) {
    try {
        if (checkConnectionTimer) {
            clearInterval(checkConnectionTimer);
            checkConnectionTimer = null;
        }

        if (smartHome)
            smartHome.finalize();

        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
}

function updateDevice(aDevice) {
    if (aDevice) {
        var devicePath = helpers.getDevicePath(aDevice);
        var room = helpers.getRoomNameForDevice(aDevice);

        var hasCapStates = function (aDevice) {
            var hasStates = false;
            if (aDevice.Capabilities) {
                aDevice.Capabilities.forEach(function (aCapability) {
                    if (aCapability.State && aCapability.State.length)
                        hasStates = true;
                });
            }

            return hasStates;
        };

        if (hasCapStates(aDevice)) {

            adapter.setObject(devicePath, {
                type: "device",
                common: {
                    name: aDevice.getName()
                },
                native: {
                    id: aDevice.id
                }
            });

            aDevice.Capabilities.forEach(function (aCapability) {
                aCapability.State.forEach(function (aState) {

                    var capabilityPath = devicePath + "." + helpers.cleanDeviceName(aState.name);

                    adapter.setObject(capabilityPath, {
                        type: "state",
                        common: helpers.merge_options({name: helpers.capitalize(aState.name)}, getCommonForState(aState)),
                        native: {
                            id: aCapability.id
                        }
                    });

                    adapter.setState(capabilityPath, {val: aState.value, ack: true});
                    helpers.addCapabilityToRoom(room, capabilityPath);
                });
            });
        }
    }
}

function stateChanged(id, state) {
    adapter.getForeignObject(id, function (err, obj) {
        if (err) {
            adapter.log.error(err);
        } else {
            if (state && !state.ack && obj && obj.native) {
                var capability = smartHome.getCapabilityById(obj.native.id);

                if (capability) {
                    if (obj.common.write) {
                        capability.setState(state.val, obj.common.name).then(function () {
                        }, function (data) {
                            adapter.log.error("STATE ERR " + JSON.stringify(data));
                        });
                    } else {
                        updateDevice(smartHome.resolveLink(capability.Device));
                    }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

function getCommonForState(aState) {
    var res = {};

    switch (aState.name) {
        // -- SHC --
        case "nextSunrise":
        case "nextSunset":
        case "nextTimeEvent":
            res.type = "string";
            res.role = "value.datetime";
            res.read = true;
            res.write = false;
            break;

        case "isDay":
            res.type = "boolean";
            res.role = "indicator.day";
            res.read = true;
            res.write = false;
            break;

        case "value":
        case "onState":
            res.type = "boolean";
            res.role = "switch";
            res.read = true;
            res.write = true;
            break;

        case "remainingQuota":
            res.type = "number";
            res.role = "indicator.quota";
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
            break;

        case "windowReductionActive":
            res.type = "boolean";
            res.role = "switch";
            res.read = true;
            res.write = true;
            break;

        case "operationMode":
            res.type = "string";
            res.role = "indicator.operationmode";
            res.read = true;
            res.write = true;
            res.states = {
                "Auto": "Automatic",
                "Manu": "Manual"
            };

            break;

        case "temperature":
            res.type = "number";
            res.role = "sensor.temperature";
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
            res.role = "sensor.humidity";
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

        // -- BEWEGUNGSMELDER --
        case "motionDetectedCount":
            res.type = "number";
            res.role = "value.state";
            res.read = true;
            res.write = false;
            break;

        case "luminance":
            res.type = "number";
            res.role = "sensor.luminance";
            res.read = true;
            res.write = false;
            res.unit = "%";
            res.min = 0;
            res.max = 100;
            break;

        // -- WANDSENDER --
        case "lastKeyPressCounter":
            res.type = "number";
            res.role = "value.state";
            res.read = true;
            res.write = false;
            break;

        case "lastPressedButtonIndex":
            res.type = "number";
            res.role = "value.state";
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
            res.role = "sensor.co2";
            res.read = true;
            res.write = false;
            res.unit = "ppm";
            break;

        case "noiseLevel":
            res.type = "number";
            res.role = "sensor.noise";
            res.read = true;
            res.write = false;
            res.unit = "dB";
            break;

        case "rainfall":
            res.type = "number";
            res.role = "sensor.rainfall";
            res.read = true;
            res.write = false;
            res.unit = "mm";
            break;


        case "atmosphericPressure":
            res.type = "number";
            res.role = "sensor.atmosphericPressure";
            res.read = true;
            res.write = false;
            res.unit = "mb";
            break;


        // -- POWERCONTROL --
        case "maximumGenerationPower":
            res.type = "number";
            res.role = "sensor.maximumGenerationPower";
            res.read = true;
            res.write = false;
            res.unit = "W";
            break;

        case "powerInWatt":
            res.type = "number";
            res.role = "sensor.power";
            res.read = true;
            res.write = false;
            res.unit = "W";
            break;

        case "energyPerMonthInKWh":
            res.type = "number";
            res.role = "sensor.power";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "energyPerMonthInEuro":
            res.type = "number";
            res.role = "sensor.power";
            res.read = true;
            res.write = false;
            res.unit = "Eur";
            break;

        case "energyPerDayInKWh":
            res.type = "number";
            res.role = "sensor.power";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "energyPerDayInEuro":
            res.type = "number";
            res.role = "sensor.power";
            res.read = true;
            res.write = false;
            res.unit = "Eur";
            break;

        case "twoWayPower":
            res.type = "number";
            res.role = "sensor.power";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "powerMedian":
            res.type = "number";
            res.role = "sensor.power";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        case "totalEnergy":
            res.type = "number";
            res.role = "sensor.power";
            res.read = true;
            res.write = false;
            res.unit = "kWh";
            break;

        // -- HUE --
        case "brightness":
            res.type = "number";
            res.role = "indicator.brightness";
            res.read = true;
            res.write = true;
            res.min = 0;
            res.max = 100;
            res.unit = "%";
            break;

        case "blink":
            res.type = "boolean";
            res.role = "indicator.blink";
            res.read = true;
            res.write = true;
            break;

        case "colorTemperature":
            res.type = "number";
            res.role = "indicator.colorTemperature";
            res.read = true;
            res.write = true;
            break;

        case "hue":
            res.type = "number";
            res.role = "indicator.hue";
            res.read = true;
            res.write = true;
            break;

        case "dimLevel":
            res.type = "number";
            res.role = "indicator.dimLevel";
            res.read = true;
            res.write = true;
            res.min = 0;
            res.max = 100;
            res.unit = "%";
            break;

        case "saturation":
            res.type = "number";
            res.role = "indicator.saturation";
            res.read = true;
            res.write = true;
            break;

        case "dynamicEffect":
            res.type = "string";
            res.role = "indicator.effect";
            res.read = true;
            res.write = true;
            break;

        case "colorMode":
            res.type = "string";
            res.role = "indicator.colorMode";
            res.read = true;
            res.write = true;
            break;

        // -- Rolladen --
        case "ShutterLevel":
        case "shutterLevel":
            res.type = "number";
            res.role = "value.level";
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
            res.role = "value.channel";
            res.read = true;
            res.write = false;
            break;

        // HTTP
        case "isSending":
            res.type = "boolean";
            res.role = "value.http";
            res.read = true;
            res.write = false;
            break;

        case "HTTPResponseStatus":
            res.type = "string";
            res.role = "value.status";
            res.read = true;
            res.write = false;
            break;

        default:
            if (adapter.config.debug)
                adapter.log.warn('Unknown state (please report to dev):' + aState.name + " " + JSON.stringify(aState));

            res.type = typeof aState !== 'object' ? typeof aState !== 'object' : "mixed";
            res.role = "value";
            res.read = true;
            res.write = true;
            break;
    }

    return res;
}