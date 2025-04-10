/**
 * @module Q
 */
/**
 * @class Q.Color
 * Operates with colors.
 * Also see http://www.phpied.com/rgb-color-parser-in-javascript/
 */
Q.Color = function _Q_Color(input) {
    if (input instanceof Array) {
        this.r = input[0];
        this.g = input[1];
        this.b = input[2];
        return;
    }
    
    let color_string = input;
    this.ok = false;

    // strip any leading #
    if (color_string.charAt(0) == '#') { // remove # if any
        color_string = color_string.substring(1,7);
    }

    color_string = color_string.replace(/ /g,'');
    color_string = color_string.toLowerCase();

    // before getting into regexps, try simple matches
    // and overwrite the input
    var simple_colors = {
        aliceblue: 'f0f8ff',
        antiquewhite: 'faebd7',
        aqua: '00ffff',
        aquamarine: '7fffd4',
        azure: 'f0ffff',
        beige: 'f5f5dc',
        bisque: 'ffe4c4',
        black: '000000',
        blanchedalmond: 'ffebcd',
        blue: '0000ff',
        blueviolet: '8a2be2',
        brown: 'a52a2a',
        burlywood: 'deb887',
        cadetblue: '5f9ea0',
        chartreuse: '7fff00',
        chocolate: 'd2691e',
        coral: 'ff7f50',
        cornflowerblue: '6495ed',
        cornsilk: 'fff8dc',
        crimson: 'dc143c',
        cyan: '00ffff',
        darkblue: '00008b',
        darkcyan: '008b8b',
        darkgoldenrod: 'b8860b',
        darkgray: 'a9a9a9',
        darkgreen: '006400',
        darkkhaki: 'bdb76b',
        darkmagenta: '8b008b',
        darkolivegreen: '556b2f',
        darkorange: 'ff8c00',
        darkorchid: '9932cc',
        darkred: '8b0000',
        darksalmon: 'e9967a',
        darkseagreen: '8fbc8f',
        darkslateblue: '483d8b',
        darkslategray: '2f4f4f',
        darkturquoise: '00ced1',
        darkviolet: '9400d3',
        deeppink: 'ff1493',
        deepskyblue: '00bfff',
        dimgray: '696969',
        dodgerblue: '1e90ff',
        feldspar: 'd19275',
        firebrick: 'b22222',
        floralwhite: 'fffaf0',
        forestgreen: '228b22',
        fuchsia: 'ff00ff',
        gainsboro: 'dcdcdc',
        ghostwhite: 'f8f8ff',
        gold: 'ffd700',
        goldenrod: 'daa520',
        gray: '808080',
        green: '008000',
        greenyellow: 'adff2f',
        honeydew: 'f0fff0',
        hotpink: 'ff69b4',
        indianred : 'cd5c5c',
        indigo : '4b0082',
        ivory: 'fffff0',
        khaki: 'f0e68c',
        lavender: 'e6e6fa',
        lavenderblush: 'fff0f5',
        lawngreen: '7cfc00',
        lemonchiffon: 'fffacd',
        lightblue: 'add8e6',
        lightcoral: 'f08080',
        lightcyan: 'e0ffff',
        lightgoldenrodyellow: 'fafad2',
        lightgrey: 'd3d3d3',
        lightgreen: '90ee90',
        lightpink: 'ffb6c1',
        lightsalmon: 'ffa07a',
        lightseagreen: '20b2aa',
        lightskyblue: '87cefa',
        lightslateblue: '8470ff',
        lightslategray: '778899',
        lightsteelblue: 'b0c4de',
        lightyellow: 'ffffe0',
        lime: '00ff00',
        limegreen: '32cd32',
        linen: 'faf0e6',
        magenta: 'ff00ff',
        maroon: '800000',
        mediumaquamarine: '66cdaa',
        mediumblue: '0000cd',
        mediumorchid: 'ba55d3',
        mediumpurple: '9370d8',
        mediumseagreen: '3cb371',
        mediumslateblue: '7b68ee',
        mediumspringgreen: '00fa9a',
        mediumturquoise: '48d1cc',
        mediumvioletred: 'c71585',
        midnightblue: '191970',
        mintcream: 'f5fffa',
        mistyrose: 'ffe4e1',
        moccasin: 'ffe4b5',
        navajowhite: 'ffdead',
        navy: '000080',
        oldlace: 'fdf5e6',
        olive: '808000',
        olivedrab: '6b8e23',
        orange: 'ffa500',
        orangered: 'ff4500',
        orchid: 'da70d6',
        palegoldenrod: 'eee8aa',
        palegreen: '98fb98',
        paleturquoise: 'afeeee',
        palevioletred: 'd87093',
        papayawhip: 'ffefd5',
        peachpuff: 'ffdab9',
        peru: 'cd853f',
        pink: 'ffc0cb',
        plum: 'dda0dd',
        powderblue: 'b0e0e6',
        purple: '800080',
        red: 'ff0000',
        rosybrown: 'bc8f8f',
        royalblue: '4169e1',
        saddlebrown: '8b4513',
        salmon: 'fa8072',
        sandybrown: 'f4a460',
        seagreen: '2e8b57',
        seashell: 'fff5ee',
        sienna: 'a0522d',
        silver: 'c0c0c0',
        skyblue: '87ceeb',
        slateblue: '6a5acd',
        slategray: '708090',
        snow: 'fffafa',
        springgreen: '00ff7f',
        steelblue: '4682b4',
        tan: 'd2b48c',
        teal: '008080',
        thistle: 'd8bfd8',
        tomato: 'ff6347',
        turquoise: '40e0d0',
        violet: 'ee82ee',
        violetred: 'd02090',
        wheat: 'f5deb3',
        white: 'ffffff',
        whitesmoke: 'f5f5f5',
        yellow: 'ffff00',
        yellowgreen: '9acd32'
    };
    for (var key in simple_colors) {
        if (color_string == key) {
            color_string = simple_colors[key];
        }
    }
    // emd of simple type-in colors

    // array of color definition objects
    var color_defs = [
        {
            re: /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/,
            example: ['rgb(123, 234, 45)', 'rgb(255,234,245)'],
            process: function (bits){
                return [
                    parseInt(bits[1]),
                    parseInt(bits[2]),
                    parseInt(bits[3])
                ];
            }
        },
        {
            re: /^(\w{2})(\w{2})(\w{2})$/,
            example: ['#00ff00', '336699'],
            process: function (bits){
                return [
                    parseInt(bits[1], 16),
                    parseInt(bits[2], 16),
                    parseInt(bits[3], 16)
                ];
            }
        },
        {
            re: /^(\w{1})(\w{1})(\w{1})$/,
            example: ['#fb0', 'f0f'],
            process: function (bits){
                return [
                    parseInt(bits[1] + bits[1], 16),
                    parseInt(bits[2] + bits[2], 16),
                    parseInt(bits[3] + bits[3], 16)
                ];
            }
        }
    ];

    // search through the definitions to find a match
    for (var i = 0; i < color_defs.length; i++) {
        var re = color_defs[i].re;
        var processor = color_defs[i].process;
        var bits = re.exec(color_string);
        if (bits) {
            channels = processor(bits);
            this.r = channels[0];
            this.g = channels[1];
            this.b = channels[2];
            this.ok = true;
        }

    }

    // validate/cleanup values
    this.r = (this.r < 0 || isNaN(this.r)) ? 0 : ((this.r > 255) ? 255 : this.r);
    this.g = (this.g < 0 || isNaN(this.g)) ? 0 : ((this.g > 255) ? 255 : this.g);
    this.b = (this.b < 0 || isNaN(this.b)) ? 0 : ((this.b > 255) ? 255 : this.b);
};

// some getters
Q.Color.prototype.toRGB = function () {
    return 'rgb(' + this.r + ', ' + this.g + ', ' + this.b + ')';
};

Q.Color.prototype.toHex = function () {
    return Q.Color.toHex(this.r, this.g, this.b);
};

/**
 * Get a color somewhere between startColor and endColor
 * @method toHex
 * @static
 * @param {String|Number} startColor 
 * @param {String|Number} endColor 
 * @param {String|Number} fraction 
 * @returns {String} a color as a hex string without '#' in front
 */
Q.Color.toHex = function (r, g, b) {
    return [r, g, b].map(x => {
        const hex = Math.round(x).toString(16)
        return hex.length === 1 ? '0' + hex : hex
    }).join('');
};
/**
 * Get a color somewhere between startColor and endColor
 * @method between
 * @static
 * @param {String|Number} startColor 
 * @param {String|Number} endColor 
 * @param {String|Number} fraction 
 * @returns {String} a color as a hex string without '#' in front
 */
Q.Color.between = function(startColor, endColor, fraction) {
    if (typeof startColor === 'string') {
        startColor = parseInt(startColor.replace('#', '0x'), 16);
    }
    if (typeof endColor === 'string') {
        endColor = parseInt(endColor.replace('#', '0x'), 16);
    }
    var startRed = (startColor >> 16) & 0xFF;
    var startGreen = (startColor >> 8) & 0xFF;
    var startBlue = startColor & 0xFF;
    var endRed = (endColor >> 16) & 0xFF;
    var endGreen = (endColor >> 8) & 0xFF;
    var endBlue = endColor & 0xFF;
    return Q.Color.toHex.apply(this, Q.interpolateArray(
        [startRed, startGreen, startBlue],
        [endRed, endGreen, endBlue],
        fraction
    ));
};
/**
 * Sets a new theme-color on the window
 * @method setWindowTheme
 * @static
 * @param {String} color in any CSS format, such as "#aabbcc"
 * @return {String} the previous color
 */
Q.Color.setWindowTheme = function (color) {
    if (Q.Color.setWindowTheme.ignore) {
        return color;
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    var prevColor = null;
    if (meta) {
        prevColor = meta.getAttribute('content');
    }
    if (color) {
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
        }
        meta.setAttribute('content', color);
    }
    return prevColor;
};
/**
 * Gets the current window theme color
 * @method getWindowTheme
 * @static
 * @param {String} color in any CSS format, such as "#aabbcc"
 * @return {String|null} the previous color, or null if it's missing
 */
Q.Color.getWindowTheme = function () {
    var meta = document.querySelector('meta[name="theme-color"]');
    return meta ? meta.getAttribute('content') : null;
};
/**
 * Generates 3 stable color components from a seed string
 * @method Q.Color.fromSeed
 * @static
 * @param {String} seed some seed to generate a color
 * @param {Object} options constraints
 */
Q.Color.fromSeed = function (seed) {
    var r = (seed || '').toString().hashCode();
    var g = r.toString().hashCode();
    var b = g.toString().hashCode();
    return [r % 256, g % 256, b % 256];
};