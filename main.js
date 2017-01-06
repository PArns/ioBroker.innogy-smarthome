/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

String.prototype.replaceAll = function (search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
var adapter = utils.adapter('innogy-smarthome');
var SmartHome = require('innogy-smarthome-lib');

var smartHome = null;

adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('objectChange', stateChanged);
adapter.on('stateChange', stateChanged);

// New message arrived. obj is array with current messages
adapter.on('message', function (obj) {
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
});

adapter.on('ready', initSmartHome);

function getDevicePath(aDevice) {
    var room = null;

    if (aDevice.Location)
        room = aDevice.Location.getName();
    else
        room = "Virtual";

    var deviceName = aDevice.getName();

    return ((room ? room + "." : "") + deviceName).replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-");
}

function initSmartHome() {
    adapter.subscribeStates('*');

    const config = {
        redirectHost: 'iobroker-connect.patrick-arns.de',
        id: '61768662',
        secret: 'no secret'
    };

    smartHome = new SmartHome(config);

    smartHome.on("needsAuthorization", function () {
        adapter.log.warn('Adapter is not configured or needs reauthorization! Please go to the adapter settings and start the authorization');
    });

    smartHome.on("stateChanged", function (aCapability) {
        var aDevice = smartHome.resolveLink(aCapability.Device);

        if (aDevice) {
            var devicePath = getDevicePath(aDevice);

            aDevice.Capabilities.forEach(function (aCapability) {
                aCapability.State.forEach(function (aState) {
                    var capabilityPath = devicePath + "." + aState.name;
                    adapter.setState(capabilityPath, {val: aState.value, ack: true});
                });
            });
        }
    });

    smartHome.on("initializationComplete", function () {
        if (smartHome.device && smartHome.device.length) {
            smartHome.device.forEach(function (aDevice) {
                updateDevice(aDevice);
            });
        }
    });

    smartHome.init();
};

function updateDevice(aDevice) {
    if (aDevice) {
        var devicePath = getDevicePath(aDevice);

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
                    type: aDevice.type,
                }
            });

            aDevice.Capabilities.forEach(function (aCapability) {
                aCapability.State.forEach(function (aState) {

                    var capabilityPath = devicePath + "." + aState.name;

                    adapter.setObjectNotExists(capabilityPath, {
                        type: "state",
                        common: merge_options({name: aState.name}, getCommonForState(aState)),
                        native: {
                            id: aCapability.Id,
                            type: aState.type
                        }
                    });

                    adapter.setState(capabilityPath, {val: aState.value, ack: true});
                });
            });
        }
    }
};

function stateChanged(id, state) {
    adapter.getForeignObject(id, function (err, obj) {
        if (err) {
            adapter.log.error(err);
        } else {
            if (state && !state.ack) {
                var capability = smartHome.getCapabilityById(obj.native.id);

                if (capability && obj.common.write) {
                    capability.setState(state.val, obj.common.name).then(function (state) {
                        adapter.log.info("OK" + state);
                    }, function (state) {
                        adapter.log.info("ERR" + state);
                    })
                } else {
                    updateDevice(smartHome.resolveLink(capability.Device));
                }
            }
        }
    });
};

function getCommonForState(aState) {
    var res = {};

    switch (aState.type) {
        case "/types/boolean":
            res.type = "boolean";
            res.role = "sensor.state";
            res.read = true;
            res.write = false;
            break;
        case "/types/OnOff":
            res.type = "boolean";
            res.role = "switch";
            res.read = true;
            res.write = true;
            break;
        case "/types/HumidityLevel":
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
            res.role = "value.temperature";
            res.read = true;
            res.write = true;
            res.unit = "°C";
            break;
        case "/types/ActualTemperature":
            res.type = "number";
            res.role = "sensor.temperature";
            res.read = true;
            res.write = false;
            res.unit = "°C";
            break;
        case "/types/device/RST.RWE/1.1/OperationMode":
            res.type = "string";
            res.role = "operationmode";
            res.read = true;
            res.write = true;
            res.states = {
                "Auto": "Automatic",
                "Manu": "Manual"
            };
            break;
        case "/types/DateTime":
            res.type = "string";
            res.role = "datetime";
            res.read = true;
            res.write = false;
            break;
        default:
            res.type = "string";
            res.role = "unknown";
    }

    return res;
};

function merge_options(obj1, obj2) {
    var obj3 = {};
    for (var attrname in obj1) {
        obj3[attrname] = obj1[attrname];
    }
    for (var attrname in obj2) {
        obj3[attrname] = obj2[attrname];
    }
    return obj3;
}