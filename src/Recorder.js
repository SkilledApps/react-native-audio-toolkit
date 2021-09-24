'use strict';

import {
  NativeModules,
  DeviceEventEmitter,
  NativeAppEventEmitter,
  Platform
} from 'react-native';

import async from 'async';
import EventEmitter from 'eventemitter3';
import MediaStates from './MediaStates';

// Only import specific items from lodash to keep build size down
import noop from 'lodash/noop';

var RCTAudioRecorder = NativeModules.AudioRecorder;

var recorderId = 0;

var defaultRecorderOptions = {
  autoDestroy: true,
  bitrate: 1280000,
  channels : 2,
  sampleRate : 44100,
  quality: 'mdeium',
  meteringInterval: '250',
};

/**
 * Represents a media recorder
 * @constructor
 */
class Recorder extends EventEmitter {
  constructor(path, options = defaultRecorderOptions) {
    super();

    this._path = path;
    this._options = { ...defaultRecorderOptions, ...options };

    this._recorderId = recorderId++;
    this._reset();

    let appEventEmitter = Platform.OS === 'ios' ? NativeAppEventEmitter : DeviceEventEmitter;

    appEventEmitter.addListener('RCTAudioRecorderEvent:' + this._recorderId, (payload: Event) => {
      this._handleEvent(payload.event, payload.data);
    });
  }

  _reset() {
    this._state = MediaStates.IDLE;
    this._duration = -1;
    this._position = -1;
    this._lastSync = -1;
  }

  _updateState(err, state) {
    this._state = err ? MediaStates.ERROR : state;
  }

  _handleEvent(event, data) {
    //console.log('event: ' + event + ', data: ' + JSON.stringify(data));
    switch (event) {
      case 'ended':
        this._state = Math.min(this._state, MediaStates.PREPARED);
        break;
      case 'info':
        // TODO
        break;
      case 'error':
        this._reset();
        //this.emit('error', data);
        break;
    }

    this.emit(event, data);
  }

  prepare(callback = noop) {
    this._updateState(null, MediaStates.PREPARING);

    // Prepare recorder
    RCTAudioRecorder.prepare(this._recorderId, this._path, this._options, (err, fsPath) => {
      this._fsPath = fsPath;
      this._updateState(err, MediaStates.PREPARED);
      callback(err, fsPath);
    });

    return this;
  }

  record(callback = noop) {
    let tasks = [];

    // Make sure recorder is prepared
    if (this._state === MediaStates.IDLE) {
      tasks.push((next) => {
        this.prepare(next);
      });
    }

    // Start recording
    tasks.push((next) => {
      RCTAudioRecorder.record(this._recorderId, next);
    });

    async.series(tasks, (err) => {
      this._updateState(err, MediaStates.RECORDING);
      callback(err);
    });

    return this;
  }

  stop(callback = noop) {
    if (this._state >= MediaStates.RECORDING) {
      RCTAudioRecorder.stop(this._recorderId, (err) => {
        this._updateState(err, MediaStates.DESTROYED);
        callback(err);
      });
    } else {
      setTimeout(callback, 0);
    }

    return this;
  }

  pause(callback = noop) {
    if (this._state >= MediaStates.RECORDING) {
      RCTAudioRecorder.pause(this._recorderId, (err) => {
        this._updateState(err, MediaStates.PAUSED);
        callback(err);
      });
    } else {
      setTimeout(callback, 0);
    }

    return this;
  }

  toggleRecord(callback = noop) {
    if (this._state === MediaStates.RECORDING) {
      this.stop((err) => {
        callback(err, true);
      });
    } else {
      this.record((err) => {
        callback(err, false);
      });
    }

    return this;
  }

  destroy(callback = noop) {
    this._reset();
    const recorderId = this._recorderId;
    return new Promise((resolve, reject) => {
      try {
        RCTAudioRecorder.destroy(recorderId, (error) => {
          if (error) {
            reject(error)
            callback(error)
          } else {
            resolve(recorderId);
            callback(recorderId);
          }
        });
      }
    })
  }

  get state()       { return this._state;                          }
  get canRecord()   { return this._state >= MediaStates.PREPARED;  }
  get canPrepare()  { return this._state == MediaStates.IDLE;      }
  get isRecording() { return this._state == MediaStates.RECORDING; }
  get isPrepared()  { return this._state == MediaStates.PREPARED;  }
  get fsPath()      { return this._fsPath; }
}

export default Recorder;
