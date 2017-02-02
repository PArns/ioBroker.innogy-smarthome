/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";
var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
var adapter = utils.adapter('innogy-smarthome');
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
        debug: true
    };

    smartHome = new SmartHome(config);

    smartHome.on("needsAuthorization", function () {
        adapter.log.warn('Adapter is not configured or needs reauthorization! Please go to the adapter settings and start the authorization');
        adapter.setState("info.connection", false, true);
    });

    smartHome.on("stateChanged", function (aCapability, debugData) {
        var aDevice = smartHome.resolveLink(aCapability.Device);

        if (debugData) {
            adapter.log.info("GOT AN STATE UPDATE " + JSON.stringify(debugData));
        }

        if (aDevice) {
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
        if (smartHome.device && smartHome.device.length) {
            adapter.log.info("INITIALIZATION COMPLETE ... GOT DEVICES: " + smartHome.device.length);
            
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
        if (typeof e === "string")
            adapter.log.error("GOT AN ERROR:" + e);
        else {
            adapter.log.error("GOT AN ERROR:" + JSON.stringify(e));

            if (e.stack) {
                adapter.log.error("STACK:" + e.stack);
            }
        }
    });

    smartHome.on("close", function (e) {
        if (typeof e === "string")
            adapter.log.debug("CLOSE:" + e);
        else
            adapter.log.debug("CLOSE:" + JSON.stringify(e));

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

            adapter.setObjectNotExists(devicePath, {
                type: "device",
                common: {
                    name: aDevice.getName()
                },
                native: {
                    id: aDevice.Id,
                    type: aDevice.type
                }
            });

            aDevice.Capabilities.forEach(function (aCapability) {
                aCapability.State.forEach(function (aState) {

                    var capabilityPath = devicePath + "." + helpers.cleanDeviceName(aState.name);

                    adapter.setObjectNotExists(capabilityPath, {
                        type: "state",
                        common: helpers.merge_options({name: aState.name}, getCommonForState(aState)),
                        native: {
                            id: aCapability.Id,
                            type: aState.type
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
            if (state && !state.ack) {
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

    switch (aState.type) {
        case "/types/OnOff":
        case "/types/boolean":
            res.type = "boolean";
            res.role = "switch";
            res.read = true;
            res.write = true;
            break;
        case "/types/OpenClose":
            res.type = "boolean";
            res.role = "sensor.window";
            res.read = true;
            res.write = true;
            res.states = {
                true: "Open",
                false: "Closed"
            };
            break;
        case "/types/IsAlarm":
            res.type = "boolean";
            res.role = "state.alarm";
            res.read = true;
            res.write = false;
            res.states = {
                true: "Alarm",
                false: "No Alarm"
            };
            break;
        case "/types/integer":
            res.type = "number";
            res.role = "value.state";
            res.read = true;
            res.write = false;
            break;
        case "/types/HumidityLevel":
        case "/types/product/WeatherStation.Netatmo/2.0/HumidityLevel":
            res.type = "number";
            res.role = "sensor.humidity";
            res.read = true;
            res.write = false;
            res.unit = "%";
            res.min = 0;
            res.max = 100;
            break;
        case "/types/TargetTemperature":
            res.type = "number";
            res.role = "level.temperature";
            res.read = true;
            res.write = true;
            res.unit = "°C";
            break;
        case "/types/ActualTemperature":
        case "/types/product/WeatherStation.Netatmo/2.0/ActualTemperature":
            res.type = "number";
            res.role = "sensor.temperature";
            res.read = true;
            res.write = false;
            res.unit = "°C";
            break;
        case "/types/product/WeatherStation.Netatmo/2.0/CarbonDioxideLevel":
            res.type = "number";
            res.role = "sensor.co2";
            res.read = true;
            res.write = false;
            res.unit = "ppm";
            break;
        case "/types/product/WeatherStation.Netatmo/2.0/NoiseLevel":
            res.type = "number";
            res.role = "sensor.noise";
            res.read = true;
            res.write = false;
            res.unit = "dB";
            break;
        case "/types/product/WeatherStation.Netatmo/2.0/RainfallAmount":
            res.type = "number";
            res.role = "sensor.rain";
            res.read = true;
            res.write = false;
            res.unit = "mm/h";
            break;
        case "/types/device/RST.RWE/1.1/OperationMode":
            res.type = "string";
            res.role = "indicator.operationmode";
            res.read = true;
            res.write = true;
            res.states = {
                "Auto": "Automatic",
                "Manu": "Manual"
            };
            break;
        case "/types/DateTime":
            res.type = "string";
            res.role = "value.datetime";
            res.read = true;
            res.write = false;
            break;
        case "/types/LuminanceLevel":
            res.type = "number";
            res.role = "sensor.luminance";
            res.read = true;
            res.write = false;
            res.unit = "%";
            res.min = 0;
            res.max = 100;
            break;
        case "/types/ShutterLevel":
            res.type = "number";
            res.role = "level.blind";
            res.read = true;
            res.write = true;
            res.unit = "%";
            res.min = 0;
            res.max = 100;
            break;
        default:
            res.type = "string";
            res.role = "unknown";
            res.read = true;
            res.write = true;
            break;
    }

    return res;
}