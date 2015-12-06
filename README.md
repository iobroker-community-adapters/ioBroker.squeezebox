![Logo](admin/squeezebox.png)
# ioBroker Logitech Squeezebox Adapter

Controls a Squeezebox Server a.k.a. Logitech Media Server and its players.

## Install

Install this adapter via ioBroker Admin.

1. Open instance config dialog
2. Enter the IP address or host name of your Squeezebox Server
3. Lower the time update interval value if you have enough performance in your system.
4. Save the configuration
5. Start the adapter

## Configuration
### Logitech Media Server Address
This is the IP address or host name of your Squeezebox Server.
The server must listen to telnet commands on TCP port 9090 (don't confuse this with the web (HTTP) port which will always be a different one).

### Track time update interval (sec)
Every N seconds the elapsed time of playing tracks is updated.
Leave this at 5 seconds if you are not using this for visualization.
If you need more precision, set it to 2 or 1 seconds.

## States

The adapter automatically connects to the configured Squeezebox Server and creates the following states for each player connected to the Squeezebox Server.

The names of the states are formatted like this: squeezebox.<instance>.<player>.<state>
- <instance> is the ioBroker adapter instance index (usually "0")
- <player> is the name you gave to the player when configuring it (spaces are replaced by underscores "_")
- <state> is described in the following sections

### squeezebox.<instance>.<player>.power
Boolean, read-write
- true: player is powered on
- false: plyer is on stand-by

### squeezebox.<instance>.<player>.state
Enumeration, read-write
- 0: Pause
- 1: Play
- 2: Stop

### squeezebox.<instance>.<player>.volume
Integer (0...100), read-write
Playback volume from nothing (0) to maximum (100)
Be careful when setting high values (>50) as this might hurt your ears (or your loved ones')!

### squeezebox.<instance>.<player>.muting
Boolean, read-write
- true: player is muted (playback continues, but loudspeaker is off)
- false: player is in regular playback mode

### squeezebox.<instance>.<player>.currentTitle
String, read-only
The name of the currently playing (or paused) song or stream. Can be empty.

### squeezebox.<instance>.<player>.currentAlbum
String, read-only
The name of the album of the currently playing (or paused) song or stream. Can be empty.

### squeezebox.<instance>.<player>.currentArtist
String, read-only
The name of the artist of the currently playing (or paused) song or stream. Can be empty.

### squeezebox.<instance>.<player>.currentDuration
Integer, read-only
The total length in seconds of the current song or stream.

### squeezebox.<instance>.<player>.currentDurationText
String, read-only
The formatted total length of the current song or stream. (Format: "[hh:]mm:ss")

### squeezebox.<instance>.<player>.elapsedTime
Integer, read-only
The number of seconds the current song or stream has been played already. This value is updated every "Track time update interval" (see Configuration above)

### squeezebox.<instance>.<player>.elapsedTimeText
String, read-only
The formatted time the current song or stream has been played already. This value is updated every "Track time update interval" (see Configuration above)

## Changelog
### 0.0.1
* (UncleSamSwiss) Initial version

## Roadmap/Todo

## License

Apache 2.0

Copyright (c) 2015 UncleSamSwiss
