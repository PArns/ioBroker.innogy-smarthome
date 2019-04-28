var adapter = null;
var rooms = [];

var getDevicePath = function (aDevice) {
    var room = getRoomNameForDevice(aDevice);
    var deviceName = aDevice.getName();

    return cleanDeviceName(room + "." + deviceName);
};

var getRoomNameForDevice = function (aDevice) {
    var room = null;

    if (aDevice.Location)
        room = aDevice.Location.getName();
    else
        room = "Virtual";

    return cleanDeviceName(room);
};

var cleanDeviceName = function (aString) {
    var cleanName = aString.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-").replaceAll("ß", "ss");
    return capitalize(cleanName);
};

var capitalize = function (aString) {
    return aString.charAt(0).toUpperCase() + aString.slice(1);
};

var merge_options = function (obj1, obj2) {
    var obj3 = {};
    for (var attrname in obj1) {
        obj3[attrname] = obj1[attrname];
    }
    for (var attrname in obj2) {
        obj3[attrname] = obj2[attrname];
    }
    return obj3;
};

var addCapabilityToRoom = function(room, capabilityPath) {
    rooms[room] = rooms[room] || [];

    var fullPath = "innogy-smarthome." + adapter.instance + "." + capabilityPath;
    rooms[room].push(fullPath);
};

var applyRooms = function() {
    for(var key in rooms) {
        var value = rooms[key];
        _addCapabilityToRoom(key, value);
    }

    rooms = [];
};

var _addCapabilityToRoom = function(room, capabilities, callback) {
    var id = ("enum.rooms." + room).toLowerCase();

    adapter.getForeignObject(id, function (err, obj) {
        if (obj) {

            capabilities.forEach(function(fullPath) {
                var pos = obj.common.members.indexOf(fullPath);
                if (pos === -1)
                    obj.common.members.push(fullPath);
            });

            adapter.setForeignObject(obj._id, obj, callback);

        } else {
            adapter.setForeignObject(id, {
                common: {
                    name: room,
                    members: capabilities
                },
                type: 'enum'
            }, callback);
        }
    });
};

module.exports =
    function (theAdapter) {
        adapter = theAdapter;

        return {
            getRoomNameForDevice: getRoomNameForDevice,
            getDevicePath: getDevicePath,
            cleanDeviceName: cleanDeviceName,
            merge_options: merge_options,
            addCapabilityToRoom:addCapabilityToRoom,
            applyRooms: applyRooms,
            capitalize: capitalize
        }
    };
