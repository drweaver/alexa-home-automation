/**
 * 
 */
var AUTH_KEY = process.env.AUTH_KEY;
var SET_DEVICE_CONFIG_URL = process.env.SET_DEVICE_CONFIG_URL;
var GET_DEVICE_STATE_URL = process.env.GET_DEVICE_STATE_URL;

var appliances = require('./appliances.json');
var rp = require('request-promise');

const CONTROL_POWER = 'Alexa.PowerController';
const CONTROL_LOCK = 'Alexa.LockController';
const DISCOVERY = 'Alexa.Discovery';
const DISCOVERY_RESPONSE = 'Discover.Response';
const ALEXA = 'Alexa';
const RESPONSE = 'Response';
const STATE_REPORT = 'StateReport';
const ERROR_RESPONSE = 'ErrorResponse';

const PAYLOAD_V = '3';

/**
 * Main entry point.
 * Incoming events from Alexa Lighting APIs are processed via this method.
 */
exports.handler = function(request, context, callback) {

    console.log('Input', request);

    switch (request.directive.header.namespace) {
    case DISCOVERY:
        handleDiscovery(request, context, callback);
        break;
    case CONTROL_POWER:
    case CONTROL_LOCK:
        handleControl(request, context, callback);
        break;
    case ALEXA:
        handleReportState(request, context, callback);
        break;
    default:
        console.log('Err', 'No supported namespace: ' + request.directive.header.namespace);
        callback('Something went wrong');
        break;
    }
};


/**
 * This method is invoked when we receive a "Discovery" message from Alexa Smart Home Skill.
 * We are expected to respond back with a list of appliances that we have discovered for a given
 * customer. 
 */
function handleDiscovery(request, context, callback) {

    var result = {
        event: {
            header: {
                namespace: DISCOVERY,
                name: DISCOVERY_RESPONSE,
                payloadVersion: PAYLOAD_V,
                messageId: request.directive.header.messageId+'-R'
            },
            payload: { 
                endpoints: appliances
            }
        }
    };

    console.log('Discovery', result);

    callback(null,result);
}

/**
 * Control events are processed here.
 * This is called when Alexa requests an action (IE turn off appliance).
 */
function handleControl(request, context, callback) {

    const cookie = request.directive.endpoint.cookie;
    const requestMethod = request.directive.header.name;    

    setDeviceConfig({deviceId: cookie.deviceId, payload: cookie['device'+requestMethod]})
        .then( () => {
            console.log('Publish successful');
            callback(null, generateControlResult(request));
        })
        .catch( err=> {
            console.error('Error with publish',err);
            callback(generateErrorResult(request, err.message));
        });

}

function handleReportState(request, context, callback) {
    const cookie = request.directive.endpoint.cookie;
    console.log(cookie);
    getDeviceState({deviceId: cookie.deviceId})
        .then( state=> {
            console.log('Device state is', state);
            callback(null, generateReportResult(request, state));
        })
        .catch( err => {
            console.error('Error with publish',err);
            callback(generateErrorResult(request, err.message));
        });

}

function getDeviceState( config ) {
    console.log(config);
    if( config === undefined || config.deviceId === undefined ) {
        throw new Error('Invalid object provided to getDeviceState, must contain deviceId');
    }
    return rp({
        method: 'POST',
        uri: GET_DEVICE_STATE_URL,
        body: {
            authKey: AUTH_KEY,
            deviceId: config.deviceId
        },
        json: true
    });
}

/**
 * setDeviceConfig 
 * @param {*} config.deviceId Device id e.g. home/socket/1/set
 * @param {*} config.payload Message to send to device e.g. on
 */
function setDeviceConfig( config ) {
    console.log('config', config);
    if( config === undefined || config.deviceId === undefined || config.payload === undefined ) {
        throw new Error('Invalid object provided to setDeviceConfig, must contain deviceId and payload parameters', config);
    }
    return rp({
        method: 'POST',
        uri: SET_DEVICE_CONFIG_URL,
        body: {
            authKey: AUTH_KEY,
            deviceId: config.deviceId,
            payload: config.payload
        },
        json: true // Automatically stringifies the body to JSON
    });
}


function generateReportResult(request, state) {

    const cookie = request.directive.endpoint.cookie;
    const controlType = cookie.interface;
    const messageId = request.directive.header.messageId + '-R';
    const correlationToken = request.directive.header.correlationToken;
    const endpointId = request.directive.endpoint.endpointId;
    const deviceState = cookie[cookie['deviceState_'+state.payload]];

    return {
        context: {
            properties: [{
                namespace: controlType,
                name: cookie.stateName,
                value: deviceState,
                timeOfSample: state.updateTime, //retrieve from result.
                uncertaintyInMilliseconds: 50
            }]
        },
        event: {
            header: {
                namespace: ALEXA,
                name: STATE_REPORT,
                payloadVersion: PAYLOAD_V,
                messageId: messageId,
                correlationToken: correlationToken
            },
            endpoint: {
                endpointId: endpointId
            },
            payload: {}
        }
    };
}

function generateControlResult(request) {

    const cookie = request.directive.endpoint.cookie;
    const requestMethod = request.directive.header.name;
    const controlType = request.directive.header.namespace;
    const messageId = request.directive.header.messageId + '-R';
    const correlationToken = request.directive.header.correlationToken;
    const endpointId = request.directive.endpoint.endpointId;

    return {
        context: {
            properties: [{
                namespace: controlType,
                name: cookie.stateName,
                value: cookie['state'+requestMethod],
                timeOfSample: new Date().toJSON(), //retrieve from result.
                uncertaintyInMilliseconds: 50
            }]
        },
        event: {
            header: {
                namespace: ALEXA,
                payloadVersion: PAYLOAD_V,
                name: RESPONSE,
                messageId: messageId,
                correlationToken: correlationToken
            },
            endpoint: {
                endpointId: endpointId
            },
            payload: {}
        }
    };
}

function generateErrorResult(request, msg) {

    const messageId = request.directive.header.messageId + '-R';
    const correlationToken = request.directive.header.correlationToken;
    const endpointId = request.directive.endpoint.endpointId;

    return {
        event: {
            header: {
                payloadVersion: PAYLOAD_V,
                namespace: ALEXA,
                name: ERROR_RESPONSE,
                messageId: messageId,
                correlationToken: correlationToken
            },
            endpoint: {
                endpointId: endpointId
            },
            payload: {
                type: 'INTERNAL_ERROR',
                message: msg
            }
        }
    };

}
