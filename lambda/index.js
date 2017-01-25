/**
 * 
 */


/**
 * These values set in lambda key/value env variables
 */
var PN_SUBKEY = process.env.pn_subkey;
var PN_PUBKEY = process.env.pn_pubkey;

var PubNub = require('pubnub');

var pubnub = new PubNub({
    subscribeKey: PN_SUBKEY,
    publishKey: PN_PUBKEY,
    ssl: true
});

var appliances = require('./appliances.json');

const CONTROL = 'Alexa.ConnectedHome.Control';
const DISCOVERY = 'Alexa.ConnectedHome.Discovery';
const PAYLOAD_V = '2';

/**
 * Main entry point.
 * Incoming events from Alexa Lighting APIs are processed via this method.
 */
exports.handler = function(event, context) {

    log('Input', event);

    switch (event.header.namespace) {
        
        /**
         * The namespace of "Discovery" indicates a request is being made to the lambda for
         * discovering all appliances associated with the customer's appliance cloud account.
         * can use the accessToken that is made available as part of the payload to determine
         * the customer.
         */
        case DISCOVERY:
            handleDiscovery(event, context);
            break;

            /**
             * The namespace of "Control" indicates a request is being made to us to turn a
             * given device on, off or brighten. This message comes with the "appliance"
             * parameter which indicates the appliance that needs to be acted on.
             */
        case CONTROL:
            handleControl(event, context);
            break;

            /**
             * We received an unexpected message
             */
        default:
            log('Err', 'No supported namespace: ' + event.header.namespace);
            context.fail('Something went wrong');
            break;
    }
};

/**
 * This method is invoked when we receive a "Discovery" message from Alexa Smart Home Skill.
 * We are expected to respond back with a list of appliances that we have discovered for a given
 * customer. 
 */
function handleDiscovery(accessToken, context) {

    /**
     * Crafting the response header
     */
    var headers = {
        namespace: DISCOVERY,
        name: 'DiscoverAppliancesResponse',
        payloadVersion: PAYLOAD_V
    };

    /**
     * Craft the final response back to Alexa Smart Home Skill. This will include all the 
     * discoverd appliances.
     */
    var payloads = {
        discoveredAppliances: appliances
    };
    var result = {
        header: headers,
        payload: payloads
    };

    log('Discovery', result);

    context.succeed(result);
}

/**
 * Control events are processed here.
 * This is called when Alexa requests an action (IE turn off appliance).
 */
function handleControl(event, context) {

    var pn_channel = event.payload.appliance.additionalApplianceDetails.pn_channel;
    var pn_msg = event.payload.appliance.additionalApplianceDetails;
    var applianceZone = event.payload.appliance.additionalApplianceDetails.zone;
    var result = {
        header: {
            namespace: CONTROL,
            payloadVersion: PAYLOAD_V,
            name: '',
            messageId: event.header.messageId
        },
        payload: {}
    };
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
     


}

/**
 * PubNub functions
 */

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
