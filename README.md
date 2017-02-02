![Logo](admin/innogy-smarthome.png)
# ioBroker.Innogy-SmartHome

[![Build](https://travis-ci.org/PArns/ioBroker.innogy-smarthome.svg?branch=master)](https://travis-ci.org/PArns/ioBroker.innogy-smarthome)

This adapter is used to connect the Innogy smarthome devices to ioBroker. You can read more about Innogy [here](https://www.innogy.com).

###Requires Node > 4.x

## Changelog

### 0.1.7
    Added the ability to detect connection problems with auto reconnect
    Better error handling

### 0.1.6
    More Innogy API error handling with general reconnect on API error
    Added connected state (yellow state)

### 0.1.5
    Added new device discovery
    Added auto connect retry for "remote access not allowed"
    Fixed exception if device was not found
    Fixed setState for RST OperationMode

### 0.1.4
    Fixed Shutter in underlying lib
    Fixed WebSocket reconnect error in underlying lib

### 0.1.3
    Added Shutter

### 0.1.2
    Optimized reconnect handling

### 0.1.1
    Fixed storing of wrong auth data & handling of wrong auth data

### 0.1.0
    Associate rooms with correct values
    Update underlying lib to handle offline crashes for Innogy API

### 0.0.11
    Corrected roles for a lot of devices

### 0.0.10
    Corrected roles for a lot of devices
    Corrected rw states for a lot of devices

### 0.0.9
    Fixed initialization sequence in underlying lib
    Fixed bootstrap sequence in underlying lib
    Fixed token refresh in underlying lib
    Removed unneeded error messages

### 0.0.8
    Improved error output once again

### 0.0.7
    Improved error output

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