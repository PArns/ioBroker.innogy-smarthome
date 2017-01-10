![Logo](admin/innogy-smarthome.png)
# ioBroker.Innogy-SmartHome

[![Build](https://travis-ci.org/PArns/ioBroker.innogy-smarthome.svg?branch=master)](https://travis-ci.org/PArns/ioBroker.innogy-smarthome)

This adapter is used to connect the Innogy smarthome devices to ioBroker. You can read more about Innogy [here](https://www.innogy.com).

###Requires Node > 4.x

## Changelog

### 0.0.6
    Removed no longer needed log errors
    Added unload method
    Optimized session refreshing

### 0.0.5
    Fixed parsing errors

### 0.0.4
    Added Netatmo Weatherstation

### 0.0.3
    Added a lot of devices
    Updated lib to reestablish Websocket connection
    Added debug event if Websocket connection is lost

### 0.0.2
    Added "Virtual" as default location for devices which doesn't have a location

### 0.0.1
    Initial commit

## License
MIT

Copyright (c) 2017 Patrick Arns <iobroker@patrick-arns.de>