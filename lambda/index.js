/**
 * 
 */
var MQTT_URL = process.env.mqtt_url;
var MQTT_USER = process.env.mqtt_user;
var MQTT_PASS = process.env.mqtt_pass;
var MQTT_PORT = process.env.mqtt_port;

var mqtt = require('mqtt');

var appliances = require('./appliances.json');

const CONTROL = 'Alexa.ConnectedHome.Control';
const DISCOVERY = 'Alexa.ConnectedHome.Discovery';
const PAYLOAD_V = '2';

const TURN_ON = 'TurnOnRequest';
const TURN_OFF = 'TurnOffRequest';
const SET_TEMP = 'SetTargetTemperatureRequest';
const INC_TEMP = 'IncrementTargetTemperatureRequest';
const DEC_TEMP = 'DecrementTargetTemperatureRequest';

const TURN_ON_CONF = 'TurnOnConfirmation';
const TURN_OFF_CONF = 'TurnOffConfirmation';

const ERR_TARGET_OFFLINE = 'TargetOfflineError';
const ERR_UNSUPPORTED_OPERATION = 'UnsupportedOperationError';


/**
 * Main entry point.
 * Incoming events from Alexa Lighting APIs are processed via this method.
 */
exports.handler = function(event, context, callback) {

    log('Input', event);

    switch (event.header.namespace) {
        case DISCOVERY:
            handleDiscovery(event, context, callback);
            break;
        case CONTROL:
            handleControl(event, context, callback);
            break;
        default:
            log('Err', 'No supported namespace: ' + event.header.namespace);
            callback('Something went wrong');
            break;
    }
};

/**
 * This method is invoked when we receive a "Discovery" message from Alexa Smart Home Skill.
 * We are expected to respond back with a list of appliances that we have discovered for a given
 * customer. 
 */
function handleDiscovery(accessToken, context, callback) {

    var headers = {
        namespace: DISCOVERY,
        name: 'DiscoverAppliancesResponse',
        payloadVersion: PAYLOAD_V
    };

    var payloads = {
        discoveredAppliances: appliances
    };
    var result = {
        header: headers,
        payload: payloads
    };

    log('Discovery', result);

    callback(null,result);
}

/**
 * Control events are processed here.
 * This is called when Alexa requests an action (IE turn off appliance).
 */
function handleControl(event, context, callback) {

    
    var detail = event.payload.appliance.additionalApplianceDetails;

    var result = {
        header: {
            namespace: CONTROL,
            payloadVersion: PAYLOAD_V,
            name: '',
            messageId: event.header.messageId
        },
        payload: {}
    };
    
    var publish = (topic, msg) => {
        return new Promise( (res,rej) => {
            var client = mqtt.connect(MQTT_URL, {username: MQTT_USER, password: MQTT_PASS, port: MQTT_PORT});
            client.on('connect', () => {
               log('MQTT Connected'); 
            });
            client.on('error', err => {
               log('MQTT Error: ', err); 
               rej(err);
               client.end();
            });
            log('Publishing '+msg+' to '+topic);
            client.publish(topic,msg,err=> {
               err ? rej(err) : res();
               client.end();
            });
        });         
    };
    
    var pubSuccess = () => {
        log('Publish successful');
        callback(null, result);
    };
    
    var pubFail = err => {
        log('Error with publish: '+err);
        callback(generateControlError(ERR_TARGET_OFFLINE));
    };
    
    var action = {
        TurnOnRequest: () => {
            result.header.name = TURN_ON_CONF;
            publish(detail.mqtt_topic, detail.mqtt_on).then(pubSuccess,pubFail);
        },
        TurnOffRequest: () => {
            result.header.name = TURN_OFF_CONF;
            publish(detail.mqtt_topic, detail.mqtt_off).then(pubSuccess,pubFail);
        }
    };
    
    if( !(event.header.name in action) ) {
        log('Unknown action: ' + event.header.name);
        return callback(generateControlError(ERR_UNSUPPORTED_OPERATION));
    }
      
    action[event.header.name]();
    
    /**
    
    var submit = () => {
      pubRequest(pn_channel, pn_msg, err => {
        if( err ) {
            log(err);
            context.fail(generateControlError('SwitchOnOffRequest', 'DEPENDENT_SERVICE_UNAVAILABLE', 'Received error from PubNub service'));
        } else {
            log('Done with result', result);
            context.succeed(result);
        }
      });
    };
    
    switch (event.header.name) {
        case 'TurnOnRequest':
            pn_msg.state = 'on';
            result.header.name = 'TurnOnConfirmation';
            submit();
            break;
        case 'TurnOffRequest':
            pn_msg.state = 'off';
            result.header.name = 'TurnOffConfirmation';
            submit();
            break;
        case 'SetTargetTemperatureRequest':
            getSchedule(applianceZone, (err,schedule) => {
                var previousTargetTemperature = undefined;
                if( !err ) {
                    previousTargetTemperature = schedule.temperature_target;
                }
                pn_msg.temperature_target = event.payload.targetTemperature.value;
                result.header.name = 'SetTargetTemperatureConfirmation';
                result.payload.targetTemperature = event.payload.targetTemperature;
                result.payload.temperatureMode = { value: 'AUTO' };
                result.payload.previousState = { targetTemperature:  { value: previousTargetTemperature }
                // , mode: { value: 'AUTO' } 
                };
                submit();
            });
            break;
        case 'IncrementTargetTemperatureRequest':
            getSchedule(applianceZone, (err,schedule) => {
                if( err ) {
                    context.fail(generateControlError('DriverInternalError'));
                } else {
                    pn_msg.temperature_target = event.payload.deltaTemperature.value + schedule.temperature_target;
                    result.header.name = 'IncrementTargetTemperatureConfirmation';
                    result.payload.targetTemperature = { value: pn_msg.temperature_target };
                    result.payload.previousState = { targetTemperature:  { value: schedule.temperature_target }
                    // , mode: { value: 'AUTO' } 
                    };
                    submit();
                }
            });
            break;
        case 'DecrementTargetTemperatureRequest':
            getSchedule(applianceZone, (err,schedule) => {
                if( err ) {
                    context.fail(generateControlError('DriverInternalError'));
                } else {
                    pn_msg.temperature_target =  schedule.temperature_target - event.payload.deltaTemperature.value;
                    result.header.name = 'DecrementTargetTemperatureConfirmation';
                    result.payload.targetTemperature = { value: pn_msg.temperature_target };
                    result.payload.previousState = { targetTemperature:  { value: schedule.temperature_target }
                    // , mode: { value: 'AUTO' } 
                    };
                    submit();
                }
            });
            break;
        default:
            return context.fail(generateControlError('UnsupportedOperationError'));
    }
     
    **/

}

/**
 * PubNub functions
 */
/**
function pubRequest(channel, message, callback) {
    log('pubnub', "Publishing message to PubNub");
    
    log('pubnub channel', channel);
    var publishConfig = {
        channel : channel,
        message : message
    };
    pubnub.publish(publishConfig, function(status, response) {
        if( status.error ) {
            callback('pubnub error: '+ status.operation);
        } else {
            callback();
        }
    });
}

function getSchedule(zone, callback) {
    pubnub.history({
            channel: 'heatingcontrol.schedule.event',
            reverse: false, 
            count: 1
        },
        function (status, response) {
            if( status.error ) {
                callback( 'PUBNUB: Failed to retrieve schedule history' );
                return;
            }
            log( 'PUBNUB','Successfully retrieved schedule history' );
            var found = false;
            response.messages.map( msg => {
                msg.entry.schedules.map(s => {
                    if( s.zone == zone && !found ) { 
                        found = true;
                        log('PUBNUB zone found: ', s);
                        callback(undefined, s);
                    }
                });
            });
            if( !found ) {
                log('PUBNUB', 'Zone not found: ' + zone);
                callback('PUBNUB: No active existing schedule for zone: '+zone);
            }
        }
    );
}
**/
/**
 * Utility functions.
 */
function log(title, msg) {
    console.log('*************** ' + title + ' *************');
    console.log(msg);
    console.log('*************** ' + title + ' End*************');
}

function generateControlError(name, payload) {
    var headers = {
        namespace: CONTROL,
        name: name,
        payloadVersion: PAYLOAD_V
    };

    var result = {
        header: headers,
        payload: payload || {}
    };

    return result;
}
