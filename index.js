const axios = require('axios');

const PLUGIN_NAME = 'homebridge-energy-price';
const ACCESSORY_NAME = 'Energy Price';

/**
 * This is the modern way of registering a plugin with Homebridge.
 * It provides the `api` object, which is used to access HAP (HomeKit Accessory Protocol) services and characteristics.
 */
module.exports = (api) => {
    api.registerAccessory(PLUGIN_NAME, ACCESSORY_NAME, EnergyPrice);
};

// --- CONSTANTS ---
const DEF_MIN_RATE = -10000;
const DEF_MAX_RATE = 10000;
const DEFAULT_INTERVAL_MINUTES = 5;

class EnergyPrice {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;

        // Store HAP objects
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;

        // Accessory information
        this.name = config.name || ACCESSORY_NAME;
        this.manufacturer = config.manufacturer || "Energy Price"; //
        this.model = config.model || "Monitor"; //

        // Configuration
        this.minRate = config.min_rate || DEF_MIN_RATE; //
        this.maxRate = config.max_rate || DEF_MAX_RATE; //
        const refreshIntervalMinutes = config.refreshInterval === undefined ? DEFAULT_INTERVAL_MINUTES : config.refreshInterval; //
        this.refreshInterval = refreshIntervalMinutes * 60000;

        // Create a new TemperatureSensor service
        this.service = new this.Service.TemperatureSensor(this.name);
        this.service.getCharacteristic(this.Characteristic.CurrentTemperature)
            .on('get', this.handleCurrentTemperatureGet.bind(this)); //

        // Create AccessoryInformation service
        this.informationService = new this.Service.AccessoryInformation()
            .setCharacteristic(this.Characteristic.Manufacturer, this.manufacturer)
            .setCharacteristic(this.Characteristic.Model, this.model); //

        // Create an axios instance for API calls
        this.axios = axios.create({});

        /**
         * The 'didFinishLaunching' event is fired when Homebridge has restored all cached accessories.
         * We use this to start our polling logic.
         */
        this.api.on('didFinishLaunching', () => {
            this.log.debug('Did finish launching, starting poll.');
            this.poll();
        });
    }

    /**
     * This method polls the ComEd API for the latest price and updates the HomeKit characteristic.
     */
    async poll() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        try {
            const response = await this.axios.get('https://hourlypricing.comed.com/api?type=currenthouraverage');
            const price = parseFloat(response.data[0].price);
            this.log.info(`Current energy price: ${price} cents/kWh`);

            if (isNaN(price)) {
                this.log.warn('Received invalid price data from API. Setting characteristic to max rate.');
                this.service.getCharacteristic(this.Characteristic.CurrentTemperature).updateValue(this._priceToCelsius(this.maxRate));
            } else {
                const tempValue = this._priceToCelsius(price);
                this.service.getCharacteristic(this.Characteristic.CurrentTemperature).updateValue(tempValue);
            }
        } catch (error) {
            this.log.error(`Error getting current billing rate: ${error.message}`);
            this.service.getCharacteristic(this.Characteristic.CurrentTemperature).updateValue(this._priceToCelsius(this.maxRate));
        }

        this.timer = setTimeout(() => this.poll(), this.refreshInterval);
    }

    /**
     * This function converts the energy price (in cents) into a Celsius value.
     * The math is a clever hack to make the Home app display the price in cents
     * as a Fahrenheit temperature value.
     *
     * How it works:
     * 1. Price in cents, P, is the input (e.g., 2.5).
     * 2. This function calculates a Celsius temperature, Tc = (P - 32) * 5 / 9.
     * 3. Homebridge reports Tc to HomeKit.
     * 4. If the user's iOS device is set to Fahrenheit, the Home app converts it back:
     * Tf = (Tc * 9 / 5) + 32
     * Tf = (((P - 32) * 5 / 9) * 9 / 5) + 32  ->  (P - 32) + 32  ->  P
     * 5. The result is the price in cents is displayed as degrees Fahrenheit (e.g., "2.5 °F").
     *
     * I have renamed the original 'convertToFahrenheit' function to '_priceToCelsius' 
     * to more accurately reflect what it does.
     */
    _priceToCelsius(price) {
        return (price - 32) * 5 / 9;
    }

    handleCurrentTemperatureGet(callback) {
        this.log.debug('Get current temperature requested');
        callback(null, this.service.getCharacteristic(this.Characteristic.CurrentTemperature).value);
    }

    getServices() {
        return [this.informationService, this.service];
    }
}