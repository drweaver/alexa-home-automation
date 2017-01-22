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

const uuid = require('uuid/v4');

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
    var result = {
        header: {
            namespace: CONTROL,
            payloadVersion: PAYLOAD_V,
            name: '',
            messageId: event.header.messageId
        },
        payload: {}
    };
    switch (event.header.name) {
        case 'TurnOnRequest':
            pn_msg.state = 'on';
            result.header.name = 'TurnOnConfirmation';
            break;
        case 'TurnOffRequest':
            pn_msg.state = 'off';
            result.header.name = 'TurnOffConfirmation';
            break;
        case 'SetTargetTemperatureRequest':
            pn_msg.target_temperature = event.payload.targetTemperature.value;
            result.header.name = 'SetTargetTemperatureConfirmation';
            result.payload.targetTemperature = event.payload.targetTemperature;
            result.payload.temperatureMode.value = 'AUTO';
            result.previousState.targetTemperature = event.payload.targetTemperature;
            result.previousState.mode.value = 'AUTO';
            break;
        case 'IncrementTargetTemperatureRequest':
            pn_msg.target_temperature = '+'+event.payload.deltaTemperature.value;
            result.header.name = 'IncrementTargetTemperatureConfirmation';
            result.deltaTemperature = event.payload.deltaTemperature;
            break;
        case 'DecrementTargetTemperatureRequest':
            pn_msg.target_temperature = '-'+event.payload.deltaTemperature.value;
            result.header.name = 'DecrementTargetTemperatureConfirmation';
            result.deltaTemperature = event.payload.deltaTemperature;
            break;
        default:
            return context.fail(generateControlError(event.header.name, 'UNSUPPORTED_OPERATION', 'Unrecognized operation'));
    }

    /**
     * Retrieve the appliance id and accessToken from the incoming message.
     */
    var applianceId = event.payload.appliance.applianceId;
    log('applianceId', applianceId);

    /**
     * Make a remote call to execute the action based on accessToken and the applianceId and the switchControlAction
     * Some other examples of checks:
     *	validate the appliance is actually reachable else return TARGET_OFFLINE error
     *	validate the authentication has not expired else return EXPIRED_ACCESS_TOKEN error
     * Please see the technical documentation for detailed list of errors
     */
     
    log('pubnub', "Publishing message to PubNub");
    
    log('pubnub channel', pn_channel);
    var publishConfig = {
        channel : pn_channel,
        message : pn_msg
    };
    pubnub.publish(publishConfig, function(status, response) {
        if( status.error ) {
            log('pubnub error', status.operation);
            context.fail(generateControlError('SwitchOnOffRequest', 'DEPENDENT_SERVICE_UNAVAILABLE', 'Received error from PubNub service'));
        } else {
            log('Done with result', result);
            context.succeed(result);
        }
    });

}

/**
 * Utility functions.
 */
function log(title, msg) {
    console.log('*************** ' + title + ' *************');
    console.log(msg);
    console.log('*************** ' + title + ' End*************');
}

function generateControlError(name, code, description) {
    var headers = {
        namespace: CONTROL,
        name: name,
        payloadVersion: PAYLOAD_V
    };

    var payload = {
        exception: {
            code: code,
            description: description
        }
    };

    var result = {
        header: headers,
        payload: payload
    };

    return result;
}
