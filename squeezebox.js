﻿// always required: utils
var utils = require('@iobroker/adapter-core');

// other dependencies:
var logitechmediaserver = require('logitechmediaserver');

// create the adapter object
var adapter = utils.Adapter('squeezebox');

var squeezeboxServer;
var devices = {}; // mapping of MAC to device object (which has a reference to the player for that device)
var currentStates = {}; // mapping of state name to state value (so we don't set the same value multiple times)

// Squeezebox Server HTTP TCP port (web interface)
var httpPort;

// unloading
adapter.on('unload', function (callback) {
    if (squeezeboxServer && squeezeboxServer.telnet) {
        try {
            // TODO: would be great if this was just squeezeboxServer.stop()
            squeezeboxServer.telnet.writeln("listen 0");
            squeezeboxServer.telnet.destroy();
        }
        catch (e) {
            adapter.log.warn("Cannot stop squeezebox server telnet connection:" + e.toString());
        }
    }

    callback();
});

// is called if a subscribed object changes
/*adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});*/

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    if (!id || !state || state.ack || currentStates[id] === state.val) {
        return;
    }

    adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
    var idParts = id.split('.');
    var dp = idParts.pop();
    
    var name = idParts.slice(2);
    if(name[name.length-1] == 'buttons') {
        name.pop();
    }
    name.join('.');
    
    var device = null;
    for (var mac in devices) {
        if (devices[mac].channelName == name) {
            device = devices[mac];
            break;
        }
    }

    if (!device || !device.player) {
        return;
    }

    var player = device.player;
    var val = state.val;
    if (dp == 'state') {
        if (val == 0) {
            player.runTelnetCmd("pause");
        }
        else if (val == 1) {
            player.switchOn();
            player.runTelnetCmd("play");
        }
        else {
            player.switchOff();
        }
    }
    else if (dp == 'power') {
        if (val == 0) {
            player.switchOff();
        }
        else {
            player.switchOn();
        }
    }
    else if (dp == 'muting') {
        player.runTelnetCmd(!!val ? 'mixer muting 1' : 'mixer muting 0'); // !! is toBoolean()
    }
    else if (dp == 'volume') {
        player.runTelnetCmd('mixer volume ' + val);
    }
    else if (dp == 'sleep') {
        player.runTelnetCmd('sleep ' + val);
    }
    else if (dp == 'pathUrl') {
        player.runTelnetCmd('playlist play ' + val);
    }
    else if(dp == 'rewind') {
        player.runTelnetCmd('button rew');
    }
    else if(dp == 'forward') {
        player.runTelnetCmd('button fwd');
    }
    else if(dp.startsWith('preset_')) {
        player.runTelnetCmd('button ' + dp + '.single');
    }
});

// startup
adapter.on('ready', function () {
    main();
});

// "override" handleLine for our "pref httpport" query
logitechmediaserver.prototype.handleLine2 = logitechmediaserver.prototype.handleLine;
logitechmediaserver.prototype.handleLine = function (buffer) {
    var self = this;
    if (!self.handle(buffer, "pref httpport", function (params, buffer) {
        httpPort = params;
        adapter.log.debug('httpport: ' + httpPort);
    })) { self.handleLine2(buffer) } ;
}

function main() {
    if (adapter.config.server == '0.0.0.0') {
        adapter.log.warn('Can\'n start adapter for invalid server address: ' + adapter.config.server);
        return;
    }

    adapter.setState('info.connection', false, true);
    adapter.subscribeStates('*');

    squeezeboxServer = new logitechmediaserver(adapter.config.server, adapter.config.port);
    squeezeboxServer.on("registration_finished", function () {
        
        // request the HTTP port
        squeezeboxServer.telnet.writeln("pref httpport ?");

        adapter.log.info('creating/updating player channels');
        for (var mac in squeezeboxServer.players) {
            adapter.log.info("Found player " + mac);
            var device = {
                mac: mac,
                name: null,
                channelName: null,
                player: squeezeboxServer.players[mac],
                duration: 0,
                elapsed: 0,
                searchingArtwork: true,
                isSleep: false,
                intervalReqTimerSleep: null
            };
            devices[mac] = device;
            preparePlayer(device);
        }
        
        adapter.setState('info.connection', true, true);
    });

    squeezeboxServer.start(adapter.config.username, adapter.config.password);
}

function setStateAck(name, value)
{
    if (currentStates[name] !== value) {
        currentStates[name] = value;
        adapter.setState(name, { val: value, ack: true });
    }
}

function toFormattedTime(time) {
    var hours = Math.floor(time / 3600);
    hours = (hours) ? (hours + ':') : '';
    var min = Math.floor(time / 60) % 60;
    if (min < 10) min = '0' + min;
    var sec = time % 60;
    if (sec < 10) sec = '0' + sec;
    
    return hours + min + ':' + sec;
}

function preparePlayer(device) {
    var player = device.player;
    
    player.on('logitech_event', function (data) {
        adapter.log.debug("Got event from " + device.mac + ": " + data);
        processSqueezeboxEvents(device, data.split(' '));
    });
    
    player.on('volume', function (data) {
        adapter.log.debug("Got volume from " + device.mac + ": " + data);
        if (device.channelName !== null) {
            setStateAck(device.channelName + '.volume', player.volume);
        }
    });
    
    player.on('signalstrength', function (data) {
        adapter.log.debug("Got signal strength from " + device.mac + ": " + data);
    });
    
    player.on('power', function (data) {
        adapter.log.debug("Got power from " + device.mac + ": " + data);
        if (device.channelName !== null) {
            setStateAck(device.channelName + '.power', data == '1');
            if(data == '0') {
                // power off means: not sleeping anymore
                setStateAck(device.channelName + '.sleep', 0);
                device.isSleep = false;
            }
        }
    });
    
    player.on('mode', function (data) {
        adapter.log.debug("Got mode from " + device.mac + ": " + data);
        if (device.channelName === null) {
            return;
        }

        if (data == 'play') {
            setStateAck(device.channelName + '.state', 1); // 1 = play
            player.runTelnetCmd('duration ?');
            if (!device.elapsedTimer) {
                player.runTelnetCmd('time ?');
            }
            return;
        }
        
        if (device.elapsedTimer) {
            clearInterval(device.elapsedTimer);
            device.elapsedTimer = null;
        }
        
        if (data == 'pause') {
            setStateAck(device.channelName + '.state', 0); // 0 = pause
        }
        else {
            setStateAck(device.channelName + '.state', 2); // 2 = stop
        }
    });
    
    player.on('name', function (data) {
        adapter.log.debug("Got name from " + device.mac + ": " + data);
        if (device.name === null) {
            device.name = data;
            completePlayer(device);
        }
    });
    
    player.on('title', function (data) {
        adapter.log.debug("Got title from " + device.mac + ": " + data);
        setStateAck(device.channelName + '.currentTitle', data);
    });
}

var channelNames = [];
function completePlayer(device) {
    var channelName = device.name.trim().replace(/\s/g, '_');
    adapter.log.debug('Player channel of ' + mac + ' is called ' + channelName);
    if (channelNames.indexOf(channelName) !== -1) {
        adapter.log.warn('channel "' + channelName + '" already exists, skipping player');
        return;
    }

    channelNames.push(channelName);
    device.channelName = channelName;
    
    // create objects
    adapter.setObject(channelName, {
        type: 'channel',
        common: {
            name: channelName,
            role: 'media.music'
        },
        native: {
            mac: device.mac,
            name: device.name
        }
    });
    createStateObject({
        name: channelName + '.buttons',
        type: 'channel',
        role: 'switch'
    });
    createStateObject({
        name: channelName + '.power',
        read: true,
        write: true,
        type: 'boolean',
        role: 'switch'
    });
    createStateObject({
        name: channelName + '.state',
        read: true,
        write: true,
        type: 'number',
        role: 'switch', // TODO: anything better???
        min: 0,
        max: 2
    });
    createStateObject({
        name: channelName + '.volume',
        read: true,
        write: true,
        type: 'number',
        role: 'level.volume',
        min: 0,
        max: 100
    });
    createStateObject({
        name: channelName + '.muting',
        read: true,
        write: true,
        type: 'boolean',
        role: 'switch'
    });
    createStateObject({
        name: channelName + '.currentTitle',
        read: true,
        write: false,
        type: 'string',
        role: 'text'
    });
    createStateObject({
        name: channelName + '.currentAlbum',
        read: true,
        write: false,
        type: 'string',
        role: 'text'
    });
    createStateObject({
        name: channelName + '.currentArtist',
        read: true,
        write: false,
        type: 'string',
        role: 'text'
    });
    createStateObject({
        name: channelName + '.currentArtwork',
        read: true,
        write: false,
        type: 'string',
        role: 'text.url'
    });
    createStateObject({
        name: channelName + '.currentDuration',
        read: true,
        write: false,
        type: 'number',
        role: 'value.interval'
    });
    createStateObject({
        name: channelName + '.currentDurationText',
        read: true,
        write: false,
        type: 'string',
        role: 'text'
    });
    createStateObject({
        name: channelName + '.elapsedTime',
        read: true,
        write: false,
        type: 'number',
        role: 'value.interval'
    });
    createStateObject({
        name: channelName + '.elapsedTimeText',
        read: true,
        write: false,
        type: 'string',
        role: 'text'
    });
    createStateObject({
        name: channelName + '.sleep',
        read: true,
        write: true,
        type: 'number',
        role: 'value.interval'
    });
    createStateObject({
        name: channelName + '.pathUrl',
        read: true,
        write: true,
        type: 'string',
        role: 'text.url'
    });
    createStateObject({
        name: channelName + '.buttons.rewind',
        read: false,
        write: true,
        type: 'boolean',
        role: 'button'
    });
    createStateObject({
        name: channelName + '.buttons.forward',
        read: false,
        write: true,
        type: 'boolean',
        role: 'button'
    });
    
    for (var i = 1; i <= 6; i++) {
        createStateObject({
            name: channelName + '.buttons.preset_' + i,
            read: false,
            write: true,
            type: 'boolean',
            role: 'button'
        });
    }

    // request all information we need
    device.player.runTelnetCmd('mixer muting ?');
    device.player.runTelnetCmd("title ?");
    device.player.runTelnetCmd("artist ?");
    device.player.runTelnetCmd("album ?");
    device.player.runTelnetCmd("mode ?");
    device.player.runTelnetCmd('status - 1 tags:K'); // get the artwork URL
}

function createStateObject(commonInfo) {
    var obj = {
        type: 'state',
        common: commonInfo,
        native: {
        }
    };
    adapter.setObject(commonInfo.name, obj);
}

function processSqueezeboxEvents(device, eventData) {
    if (eventData.length == 0)
        return;
    
    if (eventData[0] == 'playlist') {
        device.player.runTelnetCmd("title ?");
        device.player.runTelnetCmd("artist ?");
        device.player.runTelnetCmd("album ?");
        device.player.runTelnetCmd("mode ?");
        
        if (eventData[1] == 'newsong') {
            if (device.elapsedTimer) {
                clearInterval(device.elapsedTimer);
                device.elapsedTimer = null;
                device.player.runTelnetCmd('time ?');
                device.searchingArtwork = true;
                device.player.runTelnetCmd('status - 1 tags:K'); // get the artwork URL
            }
        } else if(eventData[1] == 'open') {
            setStateAck(device.channelName + '.pathUrl', eventData[2]);
        }
        return;
    }
    
    if (eventData[0] == 'artist') {
        eventData.shift();
        setStateAck(device.channelName + '.currentArtist', eventData.join(' '));
        return;
    }
    
    if (eventData[0] == 'album') {
        eventData.shift();
        setStateAck(device.channelName + '.currentAlbum', eventData.join(' '));
        return;
    }

    if (eventData[0] == 'title') {
        eventData.shift();
        setStateAck(device.channelName + '.currentTitle', eventData.join(' '));
        return;
    }
    
    if (eventData[0] == 'mixer' && eventData[1] == 'muting') {
        setStateAck(device.channelName + '.muting', eventData.length > 2 && eventData[2] == '1');
        return;
    }
    
    if (eventData[0] == 'duration') {
        var duration = Math.floor(parseFloat(eventData[1]));
        setStateAck(device.channelName + '.currentDuration', duration);
        setStateAck(device.channelName + '.currentDurationText', toFormattedTime(duration));
        device.duration = duration;
        return;
    }
    
    if (eventData[0] == 'time') {
        // start the elapsedTimer to update the ELAPSED_TIME and ELAPSED_TIME_S
        if (!device.elapsedTimer) {
            device.elapsed = Math.floor(parseFloat(eventData[1]));
            setStateAck(device.channelName + '.elapsedTime', device.elapsed);
            setStateAck(device.channelName + '.elapsedTimeText', toFormattedTime(device.elapsed));
            var interval = parseInt(adapter.config.elapsedInterval || 5);
            device.elapsedTimer = setInterval(function (mac_) {
                device.elapsed += interval;
                
                setStateAck(device.channelName + '.elapsedTime', device.elapsed);
                setStateAck(device.channelName + '.elapsedTimeText', toFormattedTime(device.elapsed));

            }, interval * 1000, device.uuid);
        }
        return;
    }
    
    if (eventData[0] == 'status') {
        if (!device.searchingArtwork) {
            return;
        }
        
        device.searchingArtwork = false;
        var last = eventData[eventData.length - 1];
        const ARTWORK_URL_PREFIX = 'artwork_url:';
        var artworkUrl = '';
        if (last.indexOf(ARTWORK_URL_PREFIX) === 0) {
            artworkUrl = last.substr(ARTWORK_URL_PREFIX.length);
            if (artworkUrl.indexOf('//') === -1) {
                artworkUrl = 'http://' + adapter.config.server + ':' + httpPort + '/' + artworkUrl;
            }
        }
        else {
            artworkUrl = 'http://' + adapter.config.server + ':' + httpPort + '/music/current/cover.jpg?player=' + device.mac + '&t=' + (new Date().getTime() % 100000);
        }
        
        setStateAck(device.channelName + '.currentArtwork', artworkUrl);
    }

    if(eventData[0] == 'sleep') {
        device.isSleep = (Number(eventData[1]) > 0);
        
        if(device.isSleep) {
            if(device.intervalReqTimerSleep === null || device.intervalReqTimerSleep === undefined) {
                adapter.log.info("got sleep " + eventData[1] + ", setting interval");
                device.intervalReqTimerSleep = setInterval(function () {
                    device.player.runTelnetCmd("sleep ?");
                }, (adapter.config.elapsedInterval || 5) * 1000);
            }
        } else {
            adapter.log.info("got sleep 0, clearing interval");
            clearInterval(device.intervalReqTimerSleep);
            device.intervalReqTimerSleep = null;
        }
       
        setStateAck(device.channelName + '.sleep', Math.floor(Number(eventData[1])));
    }
}