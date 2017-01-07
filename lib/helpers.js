var getDevicePath = function (aDevice) {
    var room = null;

    if (aDevice.Location)
        room = aDevice.Location.getName();
    else
        room = "Virtual";

    var deviceName = aDevice.getName();

    return cleanDeviceName((room ? room + "." : "") + deviceName);
};

var cleanDeviceName = function (aString) {
    return aString.replaceAll(" ", "-").replaceAll("---", "-").replaceAll("--", "-")
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

module.exports = {
    getDevicePath: getDevicePath,
    cleanDeviceName: cleanDeviceName,
    merge_options: merge_options
};