/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

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

adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});

// New message arrived. obj is array with current messages
adapter.on('message', function (obj) {
    adapter.log.warn("MESSAGE DATA");
    adapter.log.warn(JSON.stringify(obj));
    
    if (obj) {
        switch (obj.command) {
            case 'startAuth':

                smartHome.startAuthorization();
                var res = {
                    uri: smartHome.getAuthorizationStartUri()
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

adapter.on('ready', function () {
    adapter.subscribeStates('*');

    const config = {
        redirectHost: 'iobroker-connect.patrick-arns.de',
        id: '61768662',
        secret: 'no secret'
    };

    smartHome = new SmartHome(config);

    smartHome.on("needsAuthorization", function (auth) {
        adapter.log.warn('Adapter is not configured or needs reauthorization! Please go to the adapter settings and start the authorization');
    });

    smartHome.on("stateChanged", function (aCapability) {

    });

    smartHome.on("initializationComplete", function () {

    });

    smartHome.init();
});
