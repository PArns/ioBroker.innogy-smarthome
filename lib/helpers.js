let adapter = null;
let rooms = [];

const getRoomNameForDevice = function (aDevice) {
    var room = null;

    if (aDevice.Location)
        room = aDevice.Location.getName();
    else
        room = "Virtual";

    return cleanDeviceName(room);
};

const getDevicePath = function (aDevice) {
    const room = getRoomNameForDevice(aDevice);
    const deviceName = aDevice.getName();

    return cleanDeviceName(room + "." + deviceName);
};

const cleanDeviceName = function (aString) {
    let cleanName = aString
        .replaceAll(" ", "-")
        .replaceAll("---", "-")
        .replaceAll("--", "-")
        .replaceAll("ß", "ss");
    if (cleanName.endsWith(".")) {
        cleanName = cleanName.substring(0, cleanName.length - 1);
    }

    return capitalize(cleanName);
};

const capitalize = function (aString) {
    return aString.charAt(0).toUpperCase() + aString.slice(1);
};

const merge_options = function (obj1, obj2) {
    const obj3 = {};
    for (let attrname in obj1) {
        obj3[attrname] = obj1[attrname];
    }
    for (let attrname in obj2) {
        obj3[attrname] = obj2[attrname];
    }
    return obj3;
};

const addCapabilityToRoom = function(room, capabilityPath) {
    rooms[room] = rooms[room] || [];

    const fullPath = adapter.namespace + "." + capabilityPath;
    rooms[room].push(fullPath);
};

const applyRooms = function() {
    for(const key in rooms) {
        const value = rooms[key];
        _addCapabilityToRoom(key, value);
    }

    rooms = [];
};

const _addCapabilityToRoom = function(room, capabilities, callback) {
    if (!room) {
        return callback && callback();
    }

    const id = ("enum.rooms." + room).toLowerCase();

    adapter.getForeignObject(id, (err, obj) => {
        if (obj) {

            capabilities.forEach((fullPath) => {
                const pos = obj.common.members.indexOf(fullPath);
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
            getRoomNameForDevice,
            getDevicePath,
            cleanDeviceName,
            merge_options,
            addCapabilityToRoom,
            applyRooms,
            capitalize
        }
    };
