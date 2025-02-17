Q.exports(function (Q) {
    /**
     * Q plugin's front end code
     *
     * @module Q
     * @class Q.Onboarding
     */

    /**
     * Starts an onboarding process
     * @static
     * @method start
     * @param {Object} [options={}] Can be one of the following options
     */
    return function _Q_Onboarding_stop(key) {
        var instructions = Q.Onboarding.processes[key];
        if (instructions) {
            clearInterval(instructions.intervalId);
        }
    };
});