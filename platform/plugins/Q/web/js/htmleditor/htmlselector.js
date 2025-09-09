/**
 * Adds custom selection control to DOM element
 * @constructor
 * @param {DOMElement} el - DOM element
 * @param {json} options - JSON object with parameters
 *     @param {string} className - class to be applied to selected area
 *     @param {boolean} disableUserSelect - flag if userSelect: none should be applied to the element
 *     @param {boolean} forceMobileMode - skip mobile UA check and always act like it is mobile (use this to test in Chrome responsive mode)
 *     @param {json} scrollBorder - distance to window borders where scrolling should be applied
 *          @param {number} left - number of pixels from left border
 *          @param {number} right - number of pixels from right border
 *          @param {number} top - number of pixels from top border
 *          @param {number} bottom - number of pixels from bottom border
 *     @param {number} scrollSpeed - speed of scrolling in pixels
 * @returns {object} - HTMLSelector object
 */
function HTMLselector(el,options) {

    // HTMLselector object that would be returned
    var sel={
        startIndex:-1,
        endIndex:-1,
        startElement:null,
        endElement:null,
        isEmpty:true
    };

    //Default options
    sel.options = {
        scrollBorder: {
            left: 50,
            right: 50,
            top: 50,
            bottom: 50 // pixels where scrolling activates
        },
        className: 'Q_HTMLselector_selected', //this class would be applied to selected area
        selectionFadeOut: 'Q_HTMLselector_selected_fade-out', //this class would be applied to selected area
        caretLClassName:'Q_HTMLselector_caret-left',
        caretRClassName:'Q_HTMLselector_caret-right',
        caretDCId:'Q_HTMLselector_drag-caret',
        caretImgDCId:'Q_HTMLselector_img-drag-caret',
        caretCutClassName:'Q_HTMLselector_cut-caret',
        caretMovableId:'Q_HTMLselector_movable-caret',
        customCaretClassName:'Q_HTMLselector_ccaret',
        dragInsertIconId:'Q_HTMLselector_drag-insert-icon',
        dragInsertImgIconId:'Q_HTMLselector_drag-insert-img-icon',
        tempDeleteNodeTag:'Q_HTMLselector_DEL',
        magnifierClass:'Q_HTMLselector_glass',
        scrollSpeed: 5, // scrolling speed in pixels
        threshold: 5, // radius that finger can move without triggering onSelectStart
        longPressTime: 300, // time finger should stay idle after touch start and before touch move so that we force select mode (and not native scrolling)
        dragLongPressTime: 1000, // time finger should stay idle after touch start and before touch move so that we force select mode (and not native scrolling)
        forceMobileMode: true, // does what it says
        disableUserSelect: true, // disable user select on field to get rid of long tap menus (works slow, better use Cordova setting)
        drawSelectionCarets: true, // draw draggable carets at beginning and end of selection
        snapToWords: true, // should snap selection to words
        snapToParagraph:false, // should snap to paragraph
        matchPunctuationPairs:true, // seeks pairs of, for example, {}, (), or [] and includes/excludes it while selecting
        keepSelectionOnBlur:false, // should not clear selection when target element loses focus
        dragText: true, //possibility of moving text by dragging
        dragImages: true, //possibility of moving images by dragging
        tagNames: ['a','img','span','u','sub','sup','strong','b','li'],
        doubleTapInterval:300, // max ms interval between first and last tap for double tap detection
        trippleTapInterval:600, // max ms interval between first and last tap for tripple tap detection
        quadrupleTapInterval:800, // max ms interval between first and last tap for quadruple tap detection
        keyboardDelay:true, //whether we should delay keyboard on caret setting (doesn't work on iOS unless KeyboardDisplayRequiresUserAction Cordova/UIWebView option is on)
        scrollOnInput:true, //whether we should scroll the window after text input
        scrollOnTapSelect:true, //whether we should scroll the window after double/tripple tap selecting to the selected element
        scrollOnCaret:false, //whether we should srcoll to caret after its being set
        scrollOnFormat:false, //whether we should scroll after applying text format, size etc.
        caretThreshold:20,
        paragraphThreshold:40,
        scrollSelBorder:{
            top: 'auto',
            bottom: 'auto'
        },
        supportsNativePaste:false,
        undoSteps:50,
        magnifieriIos:true,
        magnifyUsingCanvas:false,
        magnifier: (function () {
            return false; // because of conflict with native magnifier
            var ua = navigator.userAgent;
            if(ua.indexOf('iPad')!=-1||ua.indexOf('iPhone')!=-1||ua.indexOf('iPod')!=-1) {
                if(this.magnifyUsingCanvas && document.querySelector('.editarea:focus') != null) return false;
                return this.magnifieriIos;
            } else return true;
        }),
        magnifyZoom:1.4
    };

    //Copy options
    if(typeof options!='undefined') {
        for (var param in options) {
            sel.options[param]=options[param];
        }
    }

    //Local properties
    var _parentElement=el,
        _wasParentElementActive = false, //(true or false) whether _parentElement was active before command has executed
        _keyboardVisible = false,
        _isMobile,
        _isiOS,
        _iOSversion,
        _windowHeight = {initial:null, previous:null},
        _isAndroid,
        _chromeVersion,
        _classApplier,
        _registeredCallbacks,
        _isEditable, //maybe this should
        _startX,
        _startY,
        _startYtop,
        _startYbottom,
        _startSelected=false,
        _startDragging=false,
        _endX,
        _endY,
        _start,
        _end,
        _backward,
        _minX,
        _minY,
        _maxX,
        _maxY,
        _prev = {//previous coordinates of touch from different functions
            prevClientY: 0, //previous Y position of touchmove event; is used to determine tap or direction of move while autoscrolling.
            prevClientX: 0,
            prevSelX: 0, //is used to detect horizontal direction of touchmove,
            prevSelY: 0, //verticle
            prevSelChar: 0, // is used to determine whether current latter was changed while touchmove
            curSelRect: null,
            selTimeout: null
        },
        _lastMutation = {
            snapshot: null,
            isSelecting: false,
            ts: null
        },
        _range,
        _prevRealSelRangeRect, //latest valid selection range that includes only nodes under current touch or near it if touch is on blank space (between lines< for example)
        _isSelecting=false,
        _isDraggingReady=false,
        _isMovingCaret=false,
        _hideMovingCaretTimeout,
        _isTouched=false,
        _scroll=false,
        _currentTouch,
        _latestTouch, // same as current touch, is defined on document touchstart
        _previousTouch, // is defined on document touchend
        _multipleTapDetection,
        _contextMenuIsOpened=false,
        _debug=false,
        _debugTimer=true,
        _isScrolling=false,
        _touchTS,
        _isLongPress=false,
        _isHolding=false,
        _longTouchTS,
        _preventScrollAndLongTouch=false, //set this to false to get native touch working, or true to get rid of native touch callout menu
        _scrollHappened=false,
        _topElementForScrollCheck = null, //element, which bottom boundary will be used as initial point by _checkScrolling function
        _lineOffset=15,
        _lineHeight,
        _isFocused=false,
        _focusOutExclude=[],
        _preventingEditareaBlurElems=[], //if editarea was blured by tap on one of these elements, it will set focus back on editarea
        _tags={},
        _tap1TS,_tap2TS,_tap3TS,
        _tapData,
        _iX,_iY,
        _iRange,
        _iEl,
        _isDocumentActiveElement=false,
        _customCaretEl,
        _customCaretTS,
        _disabled=false,
        _dragCaret,
        _movableCaret,
        _leftCaret,
        _rightCaret,
        _insertIcon, // is shown while moving text or image
        _lcX=0, // left caret X (left) position
        _lcY=0, // left caret Y (top) position
        _lcH=0, // left caret's height
        _rcX=0, // right caret X position
        _rcY=0, // right caret Y position
        _rcH=0, // right carer's height
        _mcX=0, // movable caret (tap+hold on iOS, single tap on Android) X position
        _mcY=0, // movable caret Y position
        _mcH=0, // movable caret's height
        _startT,
        _startL,
        _endT,
        _endL,
        _bufferFragment,
        _history,
        _redo,
        _htmlBeforeInput,
        _magnifierShown=false,
        _magnifierLoaded=false,
        _isResizing = false,
        _top=null,
        _visualViewportSize = {width: window.innerWidth, height: window.innerHeight};
        
    // Init select tool, register listeners
    sel.init=function() {
        if(typeof el=='undefined') return;
        var ua=navigator.userAgent;
        if(sel.options.forceMobileMode || ua.indexOf('Android')!=-1||ua.indexOf('Windows Phone')!=-1||ua.indexOf('iPad')!=-1||ua.indexOf('iPhone')!=-1||ua.indexOf('iPod')!=-1) {
            _isMobile=true;
        } else {
            _isMobile=false;
        }

        if(ua.indexOf('iPad')!=-1||ua.indexOf('iPhone')!=-1||ua.indexOf('iPod')!=-1) {
            _isiOS = true;
            var v = (navigator.appVersion).match(/OS (\d+)_(\d+)_?(\d+)?/);
            if(v != null) _iOSversion =  [parseInt(v[1], 10), parseInt(v[2], 10), parseInt(v[3] || 0, 10)];
        }

        if(ua.indexOf('Android')!=-1) {
            _isAndroid = true;
            var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
            _chromeVersion = raw ? parseInt(raw[2], 10) : false;
        }

        if(_isMobile) {
            _parentElement.addEventListener('touchstart',_handlerOnTouchStart);
            document.body.addEventListener('touchend',_handlerOnTouchEnd);
            document.body.addEventListener('touchcancel',_handlerOnTouchCancel);
            _parentElement.addEventListener('touchcancel',_handlerOnTouchCancel);
            _parentElement.addEventListener('touchmove',_handlerOnTouchMove);
            _parentElement.addEventListener('tap',_handlerOnTap);
            _parentElement.addEventListener('click',_handlerOnClick);
            _parentElement.addEventListener('blur', function () {
                _parentElement.setAttribute('contenteditable', false);
            });
        } else {
            _parentElement.addEventListener('mousedown',_handlerOnMouseDown);
            _parentElement.addEventListener('mouseup',_handlerOnMouseUp);
            _parentElement.addEventListener('mousemove',_handlerOnMouseMove);
        }        

        //_parentElement.addEventListener('selectstart', _handlerOnSelectStart);

        document.body.addEventListener('touchstart',_hadlerOnDocumentTouchStart, true);
        //There is a bug when we tap toolbar to open dropdown menu (e. g. font size) and next tap one of items - touchstart isn't triggering.
        document.body.addEventListener('mousedown',_hadlerOnDocumentTouchStart);
        document.body.addEventListener('touchend',_hadlerOnDocumentTouchEnd, false);
        document.body.addEventListener('touchmove',_hadlerOnDocumentTouchMove, true);
        //document.addEventListener('mouseup',_hadlerOnDocumentTouchEnd);

        document.addEventListener('keypress',_handlerOnKeyPress);
        document.addEventListener('keydown',_handlerOnKeyDown);
        //_parentElement.addEventListener('input',_handlerOnInput);

        document.addEventListener('selectionchange',_handlerOnDocumentSelectionChange);
        window.addEventListener('scroll',_handlerOnScroll);

        window.addEventListener('copy', _handlerOnCopy);
        window.addEventListener('cut', _handlerOnCut);
        window.addEventListener('paste', _handlerOnPaste);

        for(var i in sel.options.tagNames)
            _tags[sel.options.tagNames[i].toUpperCase()]=true;

        _isEditable=_parentElement.hasAttribute('contentEditable') && _parentElement.getAttribute('contentEditable');

        if(_parentElement.firstChild==null) {
            var t=document.createTextNode('');
            _parentElement.appendChild(t);
        }

        _range=document.createRange();

        _top=_top||document.body;
        //sel.stateSave();

        // Options for the observer (which mutations to observe)
        var config = { attributes: true, characterData: true, childList: true, subtree: true };

        // Callback function to execute when mutations are observed
        var callback = function(mutationsList) {

            var now = performance.now();
            setTimeout(function () {
                if(_isSelecting || document.querySelector('.editarea:focus') != null) return;

                if((now - _lastMutation.ts) > 2000 && _lastMutation.isSelecting == false) {

                    _takeSnapshot();

                    _lastMutation.ts = performance.now();
                    _lastMutation.isSelecting = _isSelecting;
                }
            }, 500);
        };


        if(sel.options.magnifier() && sel.options.magnifyUsingCanvas) {
            setTimeout(function () {
                _takeSnapshot();
            }, 3000)
            // Create an observer instance linked to the callback function
            var observer = new MutationObserver(callback);

            // Start observing the target node for configured mutations
            observer.observe(_parentElement, config);
        }

        window.addEventListener("qeditor_keyboard", function (e) {
           if(_debug) console.log('selector:qeditor_keyboard')
            if (e.detail.keyboardVisible) {
                _isDocumentActiveElement = true;
                _runCallback('focusin');
            } else {
                _isDocumentActiveElement = false;
            }
        });
    }

    sel.destroy = function(){
        document.body.removeEventListener('touchend',_handlerOnTouchEnd);
        document.body.removeEventListener('touchcancel',_handlerOnTouchCancel);
        document.removeEventListener('touchstart',_hadlerOnDocumentTouchStart, true);
        document.removeEventListener('mousedown',_hadlerOnDocumentTouchStart);
        document.removeEventListener('touchend',_hadlerOnDocumentTouchEnd, false);
        document.removeEventListener('touchmove',_hadlerOnDocumentTouchMove, true);
        document.removeEventListener('keypress',_handlerOnKeyPress);
        document.removeEventListener('keydown',_handlerOnKeyDown);
        document.removeEventListener('selectionchange',_handlerOnDocumentSelectionChange);
        window.removeEventListener('scroll',_handlerOnScroll);
        window.removeEventListener('copy', _handlerOnCopy);
        window.removeEventListener('cut', _handlerOnCut);
        window.removeEventListener('paste', _handlerOnPaste);
        document.removeEventListener('keydown',_handlerPauseOnKeyDown);
    }

    var _customScroll = (function () {
        let editorcontainer = document.querySelector('.Q_HTMLeditor_container');
        let scrollableElement = editorcontainer;
        let contentElement = _parentElement;
        let currentAnimationId;
        let currentAnimationId2;
        let isAnimating = false;
        let isAnimating2 = false; //animating scrolling documentElement
        let startTouch, startScrollTouch, currentTouch, initialScrollTop, initialDocScrollTop, endScrollTouchY;
        let touchStartTime, lastTouchY, lastDocScollTop, direction, speedY;
        let averageStats = [];
        // Calculate the maximum and minimum scrollTop values
        //let maxScrollTop = scrollableElement.scrollHeight - scrollableElement.clientHeight;
        let minScrollTop = 0;
        let moveEventCounter = 0;
        // Event listener for touchstart
        scrollableElement.addEventListener('touchstart', function (event) {
            onTouchStartHandler(event)
        });
    
        // Event listener for touchmove
        /* scrollableElement.addEventListener('touchmove', (event) => {
            onTouchMoveHandler(event);
        }); */
    
        // Event listener for touchend
        /* scrollableElement.addEventListener('touchend', (event) => {
            onTouchEndHandler(event);
        }); */
        visualViewport.addEventListener('scroll', (event) => {
            if(_debug) console.log('visual view port scroll')
        });
    
        function onTouchStartHandler(event) {
            if (isAnimating) {
                cancelAnimationFrame(currentAnimationId);
                isAnimating = false;
            }
            if (isAnimating2) {
                cancelAnimationFrame(currentAnimationId2);
                isAnimating2 = false;
            }
            
            startTouch = event.touches[0];
            endScrollTouchY = null;
            initialDocScrollTop = null;
        }

        function onTouchMoveHandler(event) {
            moveEventCounter++;
            
            currentTouch = event.touches[0];


            if (_isScrolling == false && moveEventCounter >= 3) {
                //_distance(currentTouch.screenX, currentTouch.screenY, startTouch.screenX, startTouch.screenY)
                //if move was more vertical than horizontal, start scrolling

                if ( Math.abs(currentTouch.screenY - startTouch.screenY) > Math.abs(currentTouch.screenX - startTouch.screenX)) {


                    _isScrolling = true;
                    startScrollTouch = currentTouch;
                    initialScrollTop = scrollableElement.scrollTop;
                    touchStartTime = event.timeStamp;
                    lastTouchY = startScrollTouch.screenY;
                    speedY = 0;
                    direction = 1;
                }

            }

            if(!_isScrolling) return false;

            if(lastTouchY != null) {
                let distanceMade = lastTouchY-currentTouch.screenY;
                let time = event.timeStamp - touchStartTime;
                //console.log(distanceMade, time)
                averageStats.push({
                    distance: distanceMade,
                    time:  time,
                    timeStamp:  event.timeStamp
                });
            }
            const deltaY = currentTouch.screenY - startScrollTouch.screenY;
            let newScrollTop = initialScrollTop - deltaY;
            
            // Update scrollTop based on touch movement
            scrollableElement.scrollTop = newScrollTop;

            let maxScrollTop = scrollableElement.scrollHeight - scrollableElement.clientHeight;
            let scrollableElRect = scrollableElement.getBoundingClientRect();
            if(scrollableElement.scrollTop == maxScrollTop && scrollableElRect.bottom > visualViewport.height) {
                if(!endScrollTouchY) endScrollTouchY = currentTouch.screenY;
                let initialDocScrollTop = document.documentElement.scrollTop;
                let docDeltaY = currentTouch.screenY - endScrollTouchY;
                document.documentElement.scrollTop = initialDocScrollTop - docDeltaY;
                //console.log('documentElement scroll', document.documentElement.scrollTop)
                return true;
            } else if(scrollableElement.scrollTop == minScrollTop && visualViewport.pageTop > 0 ) {
                if(!endScrollTouchY) endScrollTouchY = currentTouch.screenY;
                if(!initialDocScrollTop) initialDocScrollTop = document.documentElement.scrollTop;
                if(!lastDocScollTop) lastDocScollTop = initialDocScrollTop;

                let docDeltaY = currentTouch.screenY - endScrollTouchY;

                let newDocScrolLTop = document.documentElement.scrollTop - docDeltaY;

                //if you scroll visual viewport on IOS, it is jumping for some reason, to prevent it we need this condition
                if(currentTouch.screenY > lastTouchY) {
                    document.documentElement.scrollTop = initialDocScrollTop - docDeltaY;
                } else {
                }
                lastDocScollTop = newDocScrolLTop;

                lastTouchY = currentTouch.screenY;
                return true;
            }
    
            // Calculate the direction based on Y position
            if (currentTouch.screenY > lastTouchY) {
                direction = -1; // Scrolling down
            } else {
                direction = 1; // Scrolling up
            }

            lastTouchY = currentTouch.screenY;
            // Calculate the current touchmove speed
            const currentTime = event.timeStamp;
            const duration = currentTime - touchStartTime;
            const distanceY = Math.abs(currentTouch.screenY - startScrollTouch.screenY);
            speedY = distanceY / duration;

            return true;
        }

        function onTouchEndHandler(event) {
            const currentTime = event.timeStamp;
            const duration = (averageStats.length != 0 ? averageStats[averageStats.length - 1].timeStamp : currentTime) - touchStartTime;
            //console.log(lastTouchY - event.changedTouches[0].screenY, duration)

            let moveEventCounter = 0;
            let totalDistance = 0;
            let increasedCounter = 0;
            let averageStep = 10;
            let speedUp = 10;
            let eventOrder = [];
            let lastEvent = {
                time:0,
                distance: 0,
                eventContinuaty: 0,
                eventContinuatyPercent: 0
            };
            for(let i in averageStats) {
                //console.log('retime', averageStats[i].time, duration, averageStats[i].time / duration * 100)
                let eventInfo = {};

                if(Math.abs(averageStats[i].distance) > Math.abs(lastEvent.distance)) {
                    eventInfo.event = 'incremented';
                } else if (averageStats[i].distance < lastEvent.distance) {
                    eventInfo.event = 'decremented';
                } else {
                    eventInfo.event = lastEvent.event;
                }

                if(lastEvent.event == eventInfo.event && eventOrder[eventOrder.length - 1]) {
                    eventInfo = eventOrder[eventOrder.length - 1];
                    eventInfo.eventContinuaty = lastEvent.eventContinuaty + (averageStats[i].time - lastEvent.time);
                    eventInfo.eventContinuatyPercent = eventInfo.eventContinuaty / duration * 100;
                } else {
                    eventInfo.eventContinuaty = (averageStats[i].time - lastEvent.time);
                    eventInfo.eventContinuatyPercent = eventInfo.eventContinuaty / duration * 100;
                    eventOrder.push(eventInfo)
                }

                lastEvent = {
                    time: averageStats[i].time,
                    distance: averageStats[i].distance,
                    eventContinuaty: eventInfo.eventContinuaty,
                    event: eventInfo.event
                };

                totalDistance += Math.abs(averageStats[i].distance);
                averageStats[i].time = averageStats[i].time / duration * 100;
            }

            if(eventOrder.length != 0) {
                averageStep = totalDistance / averageStats.length;
    
                let latestTouchMove = eventOrder[eventOrder.length - 1];
                if(duration <=300 && latestTouchMove.event == 'increment') {
                    speedUp = 20;
                } 
            }

            
            if (_isScrolling) {
                _isScrolling = false;
                const inertiaDistance = direction * speedY * (averageStep*speedUp); // Adjust as needed

                // Calculate the new scrollTop value with bounds
                let newScrollTop = scrollableElement.scrollTop + inertiaDistance;
                let maxScrollTop = scrollableElement.scrollHeight - scrollableElement.clientHeight;

                //if (newScrollTop > maxScrollTop) newScrollTop = maxScrollTop;
                //if (newScrollTop < minScrollTop) newScrollTop = minScrollTop;
                
    
                // Apply the threshold to check if the inertiaDistance is sufficient
                let threshold = 200;
                if (Math.abs(inertiaDistance) >= threshold) {
                    simulateInertiaScroll(scrollableElement.scrollTop, newScrollTop, speedUp);
                }
            }

            averageStats = [];
        }
    
        function simulateInertiaScroll(startY, endY) {
            //console.log('simulateInertiaScroll2', scrollableElement.scrollHeight - scrollableElement.clientHeight, minScrollTop)

            const duration = 1000; // Adjust the duration as needed
            const startTime = performance.now();
            let animationId;
    
            function animateScroll(currentTime) {
                if(!isAnimating) return;
                const elapsedTime = currentTime - startTime;
                const timeRatio = Math.min(elapsedTime / duration, 1);
    
                if (timeRatio < 1) {
                    const progress = easeOutQuad(timeRatio);
                    let scrollableElRect = scrollableElement.getBoundingClientRect();

                    let maxScrollTop = scrollableElement.scrollHeight - scrollableElement.clientHeight;
                    let newScrollTop = (startY + (endY - startY) * progress);
                    if(newScrollTop <= maxScrollTop) {
                        scrollableElement.scrollTop = (startY + (endY - startY) * progress);
                    } else if(scrollableElRect.bottom > visualViewport.height) {
                        isAnimating = false;

                        scrollToAnimated(document.documentElement, document.documentElement.scrollTop + (scrollableElRect.bottom - visualViewport.height), 1000)
                    } else if(scrollableElement.scrollTop == minScrollTop && visualViewport.pageTop > 0 ) {
                        let initialDocScrollTop = document.documentElement.scrollTop;
                        isAnimating = false;        

                        //scrollToAnimated(document.documentElement, document.documentElement.scrollTop - Math.abs(scrollableElRect.top), 1000)
                    }
                    
            
                    // Limit the scrollTop within bounds during animation

                    //if (scrollableElement.scrollTop > maxScrollTop) scrollableElement.scrollTop = maxScrollTop;
                    //if (scrollableElement.scrollTop < minScrollTop) scrollableElement.scrollTop = minScrollTop;

                    //console.log('animateScroll2', scrollableElement.scrollTop, startY + (endY - startY) * progress)

                    animationId = requestAnimationFrame(animateScroll);
                } else {
                    isAnimating = false;
                    scrollableElement.scrollTop = endY;
                }
            }
    
            isAnimating = true;
            animationId = requestAnimationFrame(animateScroll);
            currentAnimationId = animationId;
        }

        function scrollToAnimated(element, to, duration) {
            const start = element.scrollTop;
            const change = to - start;
            const increment = 20;
            let currentTime = 0;
        
            function animateScroll() {
                if(!isAnimating2) return;
                currentTime += increment;
                const val = easeInOutQuad(currentTime, start, change, duration);
                element.scrollTop = val;
                if (currentTime < duration) {
                    currentAnimationId2 = requestAnimationFrame(animateScroll);
                }
            }
        
            isAnimating2 = true;
            animateScroll();

            // Easing function for smooth animation
            function easeInOutQuad(t, b, c, d) {
                t /= d / 2;
                if (t < 1) return c / 2 * t * t + b;
                t--;
                return -c / 2 * (t * (t - 2) - 1) + b;
            };
        }

        const average = array => array.reduce((a, b) => a + b) / array.length;

        function easeOutQuad(t) {
            return 1 - (1 - t) * (1 - t);
        }

        return {
            onTouchStartHandler: onTouchStartHandler,
            onTouchMoveHandler: onTouchMoveHandler,
            onTouchEndHandler: onTouchEndHandler
        }
    })();

    sel.setTopParent=function(_element) {
        if(_element) {
            if(_top) _top.removeEventListener('scroll',_handlerOnScroll);
            _top=_element;
            if(_top != document.body) {
                _top.addEventListener('scroll',_handlerOnScroll);
            } else {
                window.addEventListener('scroll',_handlerOnScroll);
            }
        }
    }

    // User input handlers

    // Mouse (Currently we don't support it)
    var _handlerOnMouseDown=function(e) {
        console.log('Mouse input not supported');
    }
    var _handlerOnMouseUp=function(e) {
        console.log('Mouse input not supported');
    }
    var _handlerOnMouseMove=function(e) {
        console.log('Mouse input not supported');
    }

    // Touch input
    // _parentElement touch listeners

    var _handlerOnTouchCancel=function(e) {
       if(_debug) console.log('_handlerOnTouchCancel');
        if(_disabled) return;
        _handlerOnTouchEnd(e);
        return;
    }

    var _selectWordOnHold = function (e, native) {
        if(_touchTS && _tap1TS && _touchTS - _tap1TS < sel.options.doubleTapInterval) return;
        if(!_isSelecting && !_isScrolling && !_isResizing && !_isMovingCaret && sel.isEmpty && e.target.nodeName != 'IMG') {
            if(_debug) console.log('_selectWordOnHold');
            _isHolding = true;

            var touch;
            if(e.touches.length==1) {
                touch=e.touches[0];
            } else return;

            var range, node, offset;
            var x=touch.clientX,y=touch.clientY;

            range = _getRangeFromPoint(e, x,y);
            if(range == null) return;
            node = range.offsetNode || range.startContainer;
            offset = range.offset || range.startOffset;

            range.collapse(true);

            var nodeValue = range.startContainer.textContent;

            var wordStartIndex, startOffset;
            for(startOffset=offset; startOffset>=0; startOffset--){
                var char = nodeValue.charAt(startOffset);
                if(/[\W\s\n]/i.test(char) == true) {
                    wordStartIndex = startOffset;
                    break;
                }
            }
            if(wordStartIndex == null) wordStartIndex = 0;

            var wordEndIndex = nodeValue.slice(offset).search(/[\W\s\n]/i);

            range.setStart(node, wordStartIndex !=-1 ? wordStartIndex+1 : 0);
            range.setEnd(node, wordEndIndex !=-1 ? offset+wordEndIndex : nodeValue.length);

            _range.setStart(range.startContainer,range.startOffset);
            _range.setEnd(range.endContainer,range.endOffset);

            if(native != null) {
                var winSel = window.getSelection();
                winSel.removeAllRanges();
                winSel.addRange(_range);
            } else {
                _applySelection();
                if(sel.options.drawSelectionCarets) _drawEnds(_range);

                var startXYcoords = _range.getClientRects()[0];
                var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                _startX=startXYcoords.left;
                _startY=scrollTop + startXYcoords.top;

                _startYtop=scrollTop + startXYcoords.top;
                _startYbottom=scrollTop + startXYcoords.bottom;
                _runCallback('selectionEnd');
            }

            return true;
        }
        return false;
    }

    var _selectLinkOnHold = function (e) {
        if(_touchTS && _tap1TS && _touchTS - _tap1TS < sel.options.doubleTapInterval) return;
        if(!_isSelecting && !_isScrolling && !_isResizing && !_isMovingCaret && _isEditable && sel.isEmpty && e.target.nodeName != 'IMG') {
            if(_debug) console.log('_selectLinkOnHold');
            _isHolding = true;

            var touch;
            if(e.touches.length==1) {
                touch=e.touches[0];
            } else return;

            var x=touch.clientX,y=touch.clientY;

            var range = document.createRange();

            var linkNode = e.target.nodeName == 'A'? e.target : (e.target.parentNode.nodeName == 'A' ? e.target : null);
            if(!linkNode) return false;

            range.selectNode(linkNode)

            _range.setStart(range.startContainer,range.startOffset);
            _range.setEnd(range.endContainer,range.endOffset);
            _applySelection();
            if(sel.options.drawSelectionCarets) _drawEnds(_range);

            var startXYcoords = _range.getClientRects()[0];
            var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            _startX=startXYcoords.left;
            _startY=scrollTop + startXYcoords.top;
            _startYtop=scrollTop + startXYcoords.top;
            _startYbottom=scrollTop + startXYcoords.bottom;

            _runCallback('selectionEnd');
            return true;
        }
        return false;
    }

    var _selectWordOnMove = function (touch, e) {
        if(!_isScrolling && _isEditable && e.target.nodeName != 'IMG') {
            _clearSelection();
            if(_debug) console.log('%c _selectWordOnMove', 'background: #66ff33;');
            _isHolding = true;

            var x=touch.clientX,y=touch.clientY;
            var range, node, offset;
            var x=touch.clientX,y=touch.clientY;
            range = _getRangeFromPoint(e, x,y);
            if(range == null) return;
            node = range.offsetNode || range.startContainer;
            offset = range.offset || range.startOffset;

            if (window.getSelection && (window.getSelection()).modify) {
                var winSel = window.getSelection();

                range.collapse(true);
                winSel.removeAllRanges();
                winSel.addRange(range);
                winSel.modify("move", "forward", "word");
                winSel.modify("extend", "backward", "word");

                try {
                    range = winSel.getRangeAt(0);
                }
                catch(error) {
                    var nodeValue = range.startContainer.textContent;

                    var wordStartIndex, startOffset;
                    for(startOffset=offset; startOffset>=0; startOffset--){
                        var char = nodeValue.charAt(startOffset);
                        if(/[\W\s\n]+?/i.test(char) == true) {
                            wordStartIndex = startOffset;
                            break;
                        }
                    }
                    if(wordStartIndex == null) wordStartIndex = 0;


                    var wordEndIndex = nodeValue.slice(offset).search(/[\W\s\n]/i);

                    range.setStart(node, wordStartIndex !=-1 ? wordStartIndex+1 : 0);
                    range.setEnd(node, wordEndIndex !=-1 ? (offset+wordEndIndex)-1 : nodeValue.length);
                }

                _range.setStart(range.startContainer,range.startOffset);
                _range.setEnd(range.endContainer,range.endOffset);
                _applySelection();
            } else if ( (winSel = document.selection) && winSel.type != "Control") {
                sel.selectWord(node, offset);
            }

            return true;
        }
        return false;
    }

    var _handlerOnTap=function(e) {
        if(_disabled) return;
    }

    var _handlerOnClick=function(e) {
        if(_disabled) return;
    }

    var _showInsertIcon = function (x, y, rect) {
        if(x == null && y == null && rect == null || (_startDragging == null && _isDraggingReady == null)) return;

        var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        if(rect) {
            y = rect.top - 21 + scrollTop;
            x = rect.left + rect.width + scrollLeft;
        }

        if(_insertIcon != null) {
            _insertIcon.style.top = y + 'px';
            _insertIcon.style.left = x + 'px';
        } else {
            var insertIcon = document.createElement('DIV');
            insertIcon.setAttribute('id', sel.options.dragInsertIconId);
            insertIcon.style.top = y + 'px';
            insertIcon.style.left = x + 'px';

            document.body.appendChild(insertIcon);
            _insertIcon = insertIcon;
        }

    }
    var _showInsertImgIcon = function (x, y, rect, img) {
        if(_debug) console.log('_showInsertImgIcon START', x, y)
        if(x == null && y == null && rect == null || (_startDragging == null && _isDraggingReady == null)) return;

        var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        if(rect) {
            y = rect.top - 21 + scrollTop;
            x = rect.left + rect.width + scrollLeft;
        }

        if(_insertIcon != null) {
            _insertIcon.style.top = y + 'px';
            _insertIcon.style.left = x + 'px';
        } else if (img){
            var insertIcon = document.createElement('DIV');
            insertIcon.setAttribute('id', sel.options.dragInsertImgIconId);
            var dragCaretImg=document.createElement('IMG');
            dragCaretImg.setAttribute('src', img.src);
            insertIcon.style.top = y + 'px';
            insertIcon.style.left = x + 'px';

            insertIcon.appendChild(dragCaretImg);

            _top.appendChild(insertIcon);
            _insertIcon = insertIcon;
        }

    }

    var _showMovableCaret = function (e) {
        return
        if(_debug) console.log('_showMovableCaret');

        var range, rect, textNode;
        var x = e.touches[0] != null ? e.touches[0].clientX : e.changedTouches[0].clientX;
        var y = e.touches[0] != null ? e.touches[0].clientY : e.changedTouches[0].clientY;
        range = document.caretRangeFromPoint(x, y);
        if(range) {
            rect = range.getClientRects()[0];
            textNode = range.startContainer;
        }

        var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        var movableCaret = document.createElement('DIV');
        movableCaret.setAttribute('id', sel.options.caretMovableId);
        movableCaret.style.height = rect.height+5+'px';

        if(_isiOS){
            _isMovingCaret = true;
            movableCaret.style.pointerEvents = 'none';
            window.addEventListener('touchmove', _startMovingCaret);
        } else {
            movableCaret.addEventListener('touchstart', function (e) {
                //movableCaret.style.pointerEvents = 'none';
                _isMovingCaret = true;
                _initMovingCaret(e.target);
                e.stopPropagation();
                e.preventDefault();
            });
        }


        var existingCaret = document.getElementById(sel.options.caretMovableId);
        _hideMovingCaret(existingCaret);

        if(!_isiOS) { //iOS has native movable caret
            document.body.appendChild(movableCaret);
        }

        _hideMovingCaretTimeout = setTimeout(function () {
            _hideMovingCaret(movableCaret);
        }, 2000);
        _movableCaret = movableCaret;

        movableCaret.style.display='';

        if(range == null || textNode.nodeType != 3) {
            movableCaret.style.top=y + scrollTop-5+'px';
            movableCaret.style.left=x + scrollLeft-1+'px';
        } else {
            movableCaret.style.top=rect.top + scrollTop-5+'px';
            movableCaret.style.left=rect.left + scrollLeft-1+'px';
        }

        if(sel.options.magnifier() && _isiOS) {
            if(document.querySelector('.editarea:focus') != null) return;
            var touch = e.touches[0];
            if(sel.options.magnifyUsingCanvas)
                _showMagnifier(touch, movableCaret);
            else _htmlMagnifier.show(x, y, movableCaret);
        }

    }

    var _initMovingCaret = function(movableCaret) {
        movableCaret.style.pointerEvents = 'none';
        window.addEventListener('touchmove', _startMovingCaret);
        //e.preventDefault();
        //e.stopPropagation();
    }
    var _startMovingCaret = function(e) {
        if(_debug) console.log('_startMovingCaret');
        window.addEventListener('touchend', _stopMovingCaret);
        if(_isMovingCaret == false) return;
        if(_hideMovingCaretTimeout != null) {clearTimeout(_hideMovingCaretTimeout); _hideMovingCaretTimeout = null;}

        setTimeout(function () {
            var movableCaret = _movableCaret;
            var touch = e.changedTouches[0];
            if(touch == null || movableCaret == null) return;

            var x = touch.clientX;
            var y = touch.clientY;

            var range, rect, textNode;

            range = document.caretRangeFromPoint(x, y)
            if(range != null) rect = range.getClientRects()[0], textNode = range.startContainer;

            var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
            var scrollTop = window.pageYOffset || document.documentElement.scrollTop;


            movableCaret.style.display='';

            var top, left;
            if(range == null || textNode.nodeType != 3) {
                top=y + scrollTop-5;
                left=x + scrollLeft-1;
            } else {
                top=rect.top + scrollTop-5;
                left=rect.left + scrollLeft-1;
            }

            movableCaret.style.top=top+'px';
            movableCaret.style.left=left+'px';


            if(sel.options.magnifier() && _magnifierShown) {
                if(sel.options.magnifyUsingCanvas)
                    _redrawMagnifier(x, y, movableCaret);
                else _htmlMagnifier.show(x, y, movableCaret);
            } else if(!_isiOS) {

                if(sel.options.magnifyUsingCanvas){
                    if(!_magnifierShown && _isMovingCaret) _showMagnifier(touch, movableCaret);
                    _redrawMagnifier(x, y, movableCaret);
                } else _htmlMagnifier.show(x, y, movableCaret);
            }

            _mcX = scrollLeft + rect.left;
            _mcY = scrollTop + rect.top;
            _mcH = rect.height;

            _checkScrolling(x, y)
        }, 0)
    }

    var _stopMovingCaret = function(e) {
        if(_debug) console.log('_stopMovingCaret');
        var movableCaret = _movableCaret;
        if(movableCaret == null) return;

        if(e.changedTouches != null)
            var touch = e.changedTouches[0];

        if(typeof touch=='undefined') return;

        var x=touch.clientX,y=touch.clientY;

        _isMovingCaret = false;
        _magnifierShown = false;
        _hideMovingCaret(movableCaret);

        var range;
        range = _getRangeFromPoint(e, x, y);
        if(range && range.startContainer != null) sel.setCaret(range.startContainer, range.startOffset);


        e.preventDefault();
        e.stopPropagation();
    }

    var _hideMovingCaret = function(movableCaret) {
        if(_debug) console.log('_hideMovingCaret');
        //var movableCaret = _movableCaret;
        if(movableCaret == null) movableCaret = document.getElementById(sel.options.caretMovableId);
        if(!movableCaret || !movableCaret.parentNode) return;
        movableCaret.parentNode.removeChild(movableCaret);

        if(sel.options.magnifyUsingCanvas)
            _hideMagnifier();
        else _htmlMagnifier.hide();

        _isMovingCaret = false;
        _movableCaret = null;

        clearTimeout(_multipleTapDetection);
        clearTimeout(_hideMovingCaretTimeout);

        window.removeEventListener('touchmove', _startMovingCaret);
        window.removeEventListener('touchend', _stopMovingCaret);
    }


    var _htmlMagnifierDiv = null;
    var _htmlMagnifier = (function () {
        var _htmlMagnifierCursor = null;
        var _editareaStyle = (window.getComputedStyle(_parentElement,null));
        let _editorContainer = document.querySelector('.Q_HTMLeditor_container');

        var hide = function() {
            //return;
            if(_htmlMagnifierDiv == null) return;
            _htmlMagnifierDiv.parentNode.removeChild(_htmlMagnifierDiv);

            _htmlMagnifierDiv = null;
            _htmlMagnifierCursor = null;
            _magnifierShown = false;

            if(_leftCaret) _leftCaret.style.pointerEvents = '';
            if(_rightCaret) _rightCaret.style.pointerEvents = '';
        }

        var show = function(x, y, trg) {
            //return;
            if(_htmlMagnifierDiv == null) {
                if(_leftCaret) _leftCaret.style.pointerEvents = 'none';
                if(_rightCaret) _rightCaret.style.pointerEvents = 'none';
            }
            setTimeout(function () {
                var lineRangeStart, lineRangeEnd;
                if (typeof document.caretRangeFromPoint != "undefined") {

                    //get the range that includes the beginning of active line
                    var editareaRect = _parentElement.getBoundingClientRect();
                    var paddingLeft = _editareaStyle.paddingLeft.replace('px', '');
                    lineRangeStart = document.caretRangeFromPoint(paddingLeft, y)

                    if(lineRangeStart) {

                        //find node at the end of current line and split it if it's going to next line
                        var paddingRight = _editareaStyle.paddingRight.replace('px', '');


                        var cursor;
                        if(_htmlMagnifierDiv == null) {
                            _htmlMagnifierDiv = document.createElement('DIV');
                            _htmlMagnifierDiv.className = 'html-magnifier';
                            var oneLineMagnifierInner = document.createElement('DIV');
                            oneLineMagnifierInner.className = 'html-magnifier-inner';
                            _htmlMagnifierDiv.appendChild(oneLineMagnifierInner);
                            document.body.appendChild(_htmlMagnifierDiv);

                            _htmlMagnifierDiv.firstChild;

                            _htmlMagnifierCursor = document.createElement('DIV');
                            _htmlMagnifierCursor.className = 'magnifier-cursor';
                            _htmlMagnifierDiv.appendChild(_htmlMagnifierCursor);
                        }


                        var magnifierContent = _htmlMagnifierDiv.firstChild;
                        magnifierContent.innerHTML = '';

                        var allDocRange = document.createRange();
                        allDocRange.setStartBefore(_parentElement.firstChild);
                        allDocRange.setEndAfter(_parentElement.lastChild);

                        magnifierContent.appendChild(allDocRange.cloneContents());



                        var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
                        var scrollTop = _parentElement.scrollTop || window.pageYOffset || document.documentElement.scrollTop;
                        var magnifierWidth = magnifierContent.offsetWidth;
                        var magnifierHeight = magnifierContent.offsetHeight;
                        var editareaOffsetWidth = _parentElement.offsetWidth;
                        var editareaOffsetHeight = _parentElement.offsetHeight;
                        //var editareaOffsetTop = _parentElement.offsetTop;
                        var editareaOffsetTop = editareaRect.top;
                        var editareaOffsetLeft = _parentElement.offsetLeft;
                        magnifierContent.style.width = editareaOffsetWidth + 'px';
                        magnifierContent.style.height = editareaOffsetHeight + 'px';
                        magnifierContent.style.paddingTop = _editareaStyle.paddingTop;
                        magnifierContent.style.paddingLeft = _editareaStyle.paddingLeft;
                        magnifierContent.style.paddingRight = _editareaStyle.fontFamily;
                        magnifierContent.style.paddingBottom = _editareaStyle.paddingBottom;
                        magnifierContent.style.fontSize = _editareaStyle.fontSize;
                        magnifierContent.style.fontStyle = _editareaStyle.fontStyle;
                        magnifierContent.style.fontVariant = _editareaStyle.fontVariant;
                        magnifierContent.style.fontWeight = _editareaStyle.fontWeight;

                        //y = y - ;

                        var zoomCF = sel.options.magnifyZoom;
                        magnifierContent.style.transform = 'scale(' + zoomCF + ')';

                        var magnifierContentRect = magnifierContent.getBoundingClientRect();


                        var scale=magnifierContentRect.width / editareaOffsetWidth;
                        var size = 120;

                        var left, top;
                        left=x-size/2;
                        top=y-size/2;

                        var wH=window.innerHeight-size/2;
                        var wW=window.innerWidth-size/2;
                        var sT=scrollTop;
                        var sL=scrollLeft;
                        if(left>(wW-size/2) && top<size/2){
                            _htmlMagnifierDiv.style.left=(sL+left-size/2)+'px';
                        } else if(left<size/2 && top<size/2){
                            _htmlMagnifierDiv.style.left=(sL+left+size/2)+'px';
                        } else if(left>size/2) {
                            _htmlMagnifierDiv.style.left=(sL+left-size/2)+'px';
                        } else {
                            _htmlMagnifierDiv.style.left=(sL+left+size/2)+'px';
                        }

                        if(top<size/2 && left>(wW-size/2)){
                            _htmlMagnifierDiv.style.top=(sT+(wH/2)-size/2)+'px';
                        } else if(top<size/2 && left<size/2){
                            _htmlMagnifierDiv.style.top=(sT+(wH/2)-size/2)+'px';
                        } else if(top>size/2) {
                            _htmlMagnifierDiv.style.top=(sT+top-size/2)+'px';
                        } else {
                            _htmlMagnifierDiv.style.top=(sT+top+size/2)+'px';
                        }

                        var sw2,sh2;
                        var sx=(scrollLeft-editareaOffsetLeft + left +size/2*(1-1/zoomCF))*scale;
                        var sy=(scrollTop-editareaOffsetTop + top + size/2*(1-1/zoomCF))*scale;
                        console.log('magnifying: top', top)
                        console.log('magnifying: sy', sy)


                        var sw=size*scale/zoomCF;
                        var sh=size*scale/zoomCF;
                        var dx=0;
                        var dy=0;
                        var dw=size;
                        var dh=size;
                        if(sx<0) {
                            dx=-sx/zoomCF;
                            sx=0;
                        } else if(sx+sw>magnifierContentRect.width) {
                            sw2=Math.floor(magnifierContentRect.width-sx);
                            dw=size*sw2/sw;
                            sw=sw2;
                        }
                        if(sy<0) {

                            dy=-sy/zoomCF;
                            sy=0;
                        } else if(sy+sh>magnifierContentRect.height) {
                            sh2=Math.floor(magnifierContentRect.height-sy);
                            dh=size*sh2/sh;
                            sh=sh2;
                        }

                        console.log('magnifying: ', editareaOffsetTop)

                        magnifierContent.style.top = -Math.abs(sy) + 'px';
                        magnifierContent.style.left = -Math.abs(sx) + 'px';

                        var l,t,h;
                        if(trg==_rightCaret) {
                            l=_rcX;
                            t=_rcY;
                            h=_rcH;
                        } else if (trg==_leftCaret){
                            l=_lcX;
                            t=_lcY;
                            h=_lcH;
                        } else if (trg.id==sel.options.caretMovableId){
                            l=_mcX;
                            t=_mcY;
                            h=_mcH;
                        }

                        if(typeof l=='undefined') {
                            var rangeRect = document.caretRangeFromPoint(x, y);
                            if(rangeRect) {
                                var rects=rangeRect.getClientRects();
                                var rect=rects[0];
                                if(rects.length>1 && rect.width==0) rect=rects[1];

                                if(rect) {
                                    l=sL + (typeof rect.x!='undefined'?rect.x:rect.left);
                                    t=sT + (typeof rect.y!='undefined'?rect.y:rect.top);
                                    h=rect.height;
                                }
                            }
                        }

                        var offsetLeft = Math.sign(sL+x-size/2/zoomCF) != -1 ? sL+x-size/2/zoomCF : 0;
                        var offsetTop = (sT+y-size/2/zoomCF) > size ? (sT+y-size/2/zoomCF) : size;
                        _htmlMagnifierCursor.style.left = (l - offsetLeft - 1)*zoomCF + 'px';
                        _htmlMagnifierCursor.style.top =  (t - offsetTop)*zoomCF + 'px';
                        _htmlMagnifierCursor.style.height =  h*zoomCF + 'px';

                        _magnifierShown = true;

                    }
                }
            }(x, y, trg), 0);

        }

        return {
            show: show,
            hide: hide,
        }
    }());

    var _handlerOnTouchStart=async function(e) {
        if(_debug) console.log('_handlerOnTouchStart');
       
        e.preventDefault();
        /* await new Promise(function (resolve) {
            setTimeout(function() {
                resolve();
            }, 300)
        }); */
        //e.stopPropagation();
        if(_disabled) return;
        _debugTimer = performance.now()
        _isTouched=true;
        _wasParentElementActive = false;
        var touch;

        if(e.touches.length==1) {
            touch=e.touches[0];
            _currentTouch={
                id:touch.identifier,
                trg:e.currentTarget,
                withinSelection:false,
                withinImage:e.target.nodeName == 'IMG' ? true : false,
                clientX:touch.clientX,
                clientY:touch.clientY,
                pageX:touch.pageX,
                pageY:touch.pageY,
                top:window.pageYOffset || document.documentElement.scrollTop,
                left:window.pageXOffset || document.documentElement.scrollLeft
            };
        } else return;

        var x, y;
        x=touch.clientX,y=touch.clientY;


        //check if touch is being happened within selection
        var rangeRects = _range.getClientRects();
        if(rangeRects.length != 0) {
            var selRect, i;
            for (i = 0; selRect = rangeRects[i]; i++) {
                if(selRect.width == 0) continue;
                if (x >= selRect.left && x <= selRect.right && y >= selRect.top && y <= selRect.bottom) {
                    _currentTouch.withinSelection = true;
                    break;
                }
            }
        }

        //check whether we should modify existing selection
        if(_rightCaret && _leftCaret) {
            var rightCrtPos = _rightCaret.getBoundingClientRect();
            var leftCrtPos = _leftCaret.getBoundingClientRect()

            var distBetwCarets = _distance(rightCrtPos.left,rightCrtPos.top, leftCrtPos.left,leftCrtPos.top);
            var distToRightCrt = _distance(x,y,rightCrtPos.left,rightCrtPos.top);
            var distToLeftCrt = _distance(x,y,leftCrtPos.left,leftCrtPos.top);

            if(distToLeftCrt <= Math.min(sel.options.caretThreshold, distBetwCarets/10)) {
                if(_debug) console.log('%c _handlerOnTouchStart : left : (start selection process)', 'background: blue; color: white;');
                _selHandlerOnTouchStart(e,_leftCaret);
                return;
            } else if(distToRightCrt <= Math.min(sel.options.caretThreshold, distBetwCarets/10)) {
                if(_debug) console.log('%c _handlerOnTouchStart : right : (start selection process)', 'background: blue; color: white;');
                _selHandlerOnTouchStart(e,_rightCaret);
                return;
            }
        }

        if(_rightCaret) {
            var ofst=_rightCaret.getBoundingClientRect();
            var d=_distance(x,y,ofst.left,ofst.top);
            if(d<sel.options.caretThreshold) {
                if(_debug) console.log('%c _handlerOnTouchStart : _rightCaret : _selHandlerOnTouchStart (start selection process)', 'background: blue; color: white;');
                _selHandlerOnTouchStart(e,_rightCaret);
                return;
            }
        }
        if(_leftCaret) {

            var ofst=_leftCaret.getBoundingClientRect();
            var d=_distance(x,y,ofst.left,ofst.top);
            if(d<sel.options.caretThreshold) {
                if(_debug) console.log('%c _handlerOnTouchStart : _leftCaret : _selHandlerOnTouchStart (start selection process)', 'background: blue; color: white;');
                _selHandlerOnTouchStart(e,_leftCaret);
                return;
            }
        }

        //if(_hideMovingCaretTimeout != null) {_hideMovingCaret()};
        _parentElement.addEventListener('touchend', function (e) {
            if(_longTouchTS != null){
                clearTimeout(_longTouchTS);
            }
        }, {once: true})

        _longTouchTS = window.setTimeout(function() {
            if(_isSelecting) return;

            _disableUserSelectFix(false);

            if(_isAndroid) {
                if (_currentTouch != null && !_currentTouch.withinSelection) {
                    /*if (e.target.nodeName == 'A' || e.target.parentNode.nodeName == 'A') {
                        _selectLinkOnHold(e);
                        return;
                    } else if (_selectWordOnHold(e)) return;*/
                }
            } else if(_isiOS) {
                if (_currentTouch != null && !_currentTouch.withinSelection) {
                    if (e.target.nodeName != 'IMG') {
                        _showMovableCaret(e);
                        return;
                    }
                }

            }


            //timeout to capture long touch
            _longTouchTS = window.setTimeout(function() {
                if(sel.isEmpty && e.target.nodeName != "IMG") return;
                var range, rect, textNode;
                range = document.caretRangeFromPoint(x, y);
                if(range) {
                    rect = range.getClientRects()[0];
                    textNode = range.startContainer;
                }

                var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
                var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                if(_top!=document.body) {
                    var oft=_offset(_top);
                    scrollTop+=_top.scrollTop-oft.top;
                    scrollLeft+=_top.scrollLeft-oft.left;
                }

                if(!sel.isEmpty && e.target.nodeName != "IMG") {
                    if(_currentTouch == null || !_currentTouch.withinSelection) return;


                    var dragCaret = document.createElement('DIV');
                    dragCaret.setAttribute('id', sel.options.caretDCId);
                    if(_parentElement.parentElement) _parentElement.parentElement.appendChild(dragCaret);

                    dragCaret.style.display='';

                    if(sel.options.magnifier()) {

                        var isNotFocused = document.querySelector('.editarea:focus') == null;
                        if(sel.options.magnifyUsingCanvas && _isiOS && isNotFocused) {
                            _showMagnifier(touch,dragCaret);
                        } else if(_isiOS && isNotFocused) {
                            _htmlMagnifier.show(x, y, dragCaret);
                        } else if(!_isiOS) {
                            _htmlMagnifier.show(x, y, dragCaret);
                        }
                        e.stopPropagation();
                    }


                    if(range == null || textNode.nodeType != 3) {
                        dragCaret.style.top=y + scrollTop-5+'px';
                        dragCaret.style.left=x + scrollLeft-1+'px';
                    } else {
                        dragCaret.style.top=rect.top + scrollTop-5+'px';
                        dragCaret.style.left=rect.left + scrollLeft-1+'px';
                    }


                    setTimeout(function () {
                        if(sel.options.magnifyUsingCanvas && _isiOS && isNotFocused) {
                            if(_debug) console.log('show drag caret 1')
                            var magnifierDiv = document.getElementsByClassName(sel.options.magnifierClass)[0];
                            _showInsertIcon(dragCaret.style.left, dragCaret.style.top, magnifierDiv != null ? magnifierDiv.getClientRects()[0] : null);
                        } else if (_htmlMagnifierDiv) {
                            if(_debug) console.log('show drag caret 2')
                            _showInsertIcon(dragCaret.style.left, dragCaret.style.top, _htmlMagnifierDiv != null ? _htmlMagnifierDiv.getClientRects()[0] : null)
                        }
                    }, 700);

                    _dragCaret = dragCaret;

                    _isDraggingReady = true;
                } else if (e.target.nodeName == "IMG") {
                    _dragCaret = document.createElement('DIV');
                    _dragCaret.setAttribute('id', sel.options.caretImgDCId);
                    _top.appendChild(_dragCaret);

                    if(sel.options.magnifier()) {

                        var isNotFocused = document.querySelector('.editarea:focus') == null;
                        if(sel.options.magnifyUsingCanvas && _isiOS && isNotFocused)
                            _showMagnifier(touch,_dragCaret);
                        else if(_isiOS && isNotFocused)
                            _htmlMagnifier.show(x, y, e.target);
                        else if(!_isiOS)
                            _htmlMagnifier.show(x, y, e.target);

                        e.stopPropagation();
                    }

                    if(range == null || textNode.nodeType != 3) {
                        if(_debug) console.log('make drag caret 1')

                        _dragCaret.style.top=y + scrollTop-5+'px';
                        _dragCaret.style.left=x + scrollLeft-1+'px';
                    } else {
                        if(_debug) console.log('make drag caret 2')
                        _dragCaret.style.top=rect.top + scrollTop-5+'px';
                        _dragCaret.style.left=rect.left + scrollLeft-1+'px';
                    }
                    _isDraggingReady = true;

                    setTimeout(function () {
                        if(sel.options.magnifyUsingCanvas && _isiOS && !_isDocumentActiveElement) {
                            if(_debug) console.log('show drag caret 1')
                            var magnifierDiv = document.getElementsByClassName(sel.options.magnifierClass)[0];
                            _showInsertImgIcon(_dragCaret.style.left, _dragCaret.style.top, magnifierDiv != null ? magnifierDiv.getClientRects()[0] : null, e.target)
                        } else {
                            if(_debug) console.log('show drag caret 2')
                            _showInsertImgIcon(_dragCaret.style.left, _dragCaret.style.top, null, e.target)
                        }

                    }, 700);
                }

                var drawEndsAfterWordSelected = function () {
                    if(_dragCaret.parentNode)_dragCaret.parentNode.removeChild(_dragCaret)
                    document.removeEventListener('touchend', drawEndsAfterWordSelected, false);
                }
                document.addEventListener('touchend', drawEndsAfterWordSelected, false);
            }, 200);
        },300);

        _checkHasStateToSave();
        //This is only needed to fix iOS long tap
        _disableUserSelectFix(false);

        _setLimits();

        _isSelecting=false;
        _isScrolling=false;
        _isLongPress=false;
        _touchTS=performance.now();

        _iX=x;
        _iY=y;
        _iRange=document.caretRangeFromPoint(x, y);
        _iEl=document.elementFromPoint(x,y);

        //_setSelectionStartFromXY(x,y,false,sel.options.snapToWords,sel.options.snapToParagraph);
        _startSelected=false;

        //This is only needed to fix iOS long tap
        _disableUserSelectFix(true);

        //e.preventDefault();

        if(_preventScrollAndLongTouch || typeof _tap1TS!='undefined' && (+new Date)-_tap1TS<sel.options.doubleTapInterval) e.preventDefault();
    }

    var _handlerOnTouchEnd=function(e) {
        if(_disabled) return;
        if(_debug) console.log('_handlerOnTouchEnd START', performance.now() - _touchTS, e.timeStamp);
        var touch;
        if(_currentTouch==null) return
        
        if(_isScrolling) {
            _customScroll.onTouchEndHandler(e)
            return;
        }

        var now=performance.now();
        //if(_isHolding && now-_touchTS >= sel.options.longPressTime && !_isSelecting && !_startDragging && !_isScrolling) {_isHolding = false; e.preventDefault(); return;}
        //if(_isLongPress || _distance(x,y,_iX,_iY) > sel.options.threshold && !_isSelecting && !_isDraggingReady && !_isScrolling) {_isLongPress = false; return;}
        //_parentElement.setAttribute('contentEditable',true);
        //e.preventDefault();
        //e.stopPropagation();
        for(var i in e.changedTouches) {
            if(e.changedTouches[i].identifier==_currentTouch.id) {
                touch=e.changedTouches[i];
                break;
            }
        }
        if(typeof touch=='undefined') return;
        var x=touch.clientX,y=touch.clientY;


        if(_currentTouch.isSelCaret) {
            _selHandlerOnTouchEnd(e,_currentTouch.isSelCaret);
            //Should not get here
            return;
        }

        //This is only needed to fix iOS long tap
        //_disableUserSelectFix(false);


        x=Math.max(_minX,x);
        x=Math.min(_maxX,x);
        y=Math.max(_minY,y);
        y=Math.min(_maxY,y);


        //start dragging text/images
        if(_startDragging && !_isSelecting && !_isScrolling) {
            sel.stateSave();

            var range, textNode, offset;

            range = _getRangeFromPoint(e, x, y);
            textNode = range.offsetNode || range.startContainer;
            offset = range.offset || range.startOffset;

            var existingCaret = e.target.nodeName == "IMG" ? document.getElementById(sel.options.caretImgDCId) : document.getElementById(sel.options.caretDCId);
            if (textNode && textNode.nodeType == 3 && textNode.parentElement.className != sel.options.className && _iEl.nodeName != "IMG") {

                var nodeToMove;
                if(!sel.isEmpty && sel.range != null && sel.options.dragText) {

                    nodeToMove = sel.range.cloneContents().cloneNode(true);
                    var beforeNode = textNode.splitText(offset);
                    beforeNode.parentNode.insertBefore(nodeToMove, beforeNode);
                    range = range.cloneRange();
                    range.setStart(textNode,textNode.textContent.length);
                    range.setEnd(beforeNode,0);



                    sel.range.deleteContents();
                    _clearSelection();

                    _range.setStart(range.startContainer,range.startOffset);
                    _range.setEnd(range.endContainer,range.endOffset);

                    _applySelection();
                    if(sel.options.drawSelectionCarets) _drawEnds(_range);

                } else if(sel.isEmpty && e.target.nodeName == "IMG" && sel.options.dragImages) {
                    var beforeNode = textNode.splitText(offset);
                    nodeToMove = e.target.cloneNode(true);
                    e.target.parentNode.removeChild(e.target);
                    textNode.parentNode.insertBefore(nodeToMove, beforeNode);

                    _clearSelection();
                }

                if (existingCaret != null) existingCaret.parentNode.removeChild(existingCaret);

            } else {
                if (existingCaret != null) existingCaret.parentNode.removeChild(existingCaret);
            }

            if(sel.options.magnifier()) {
                if(sel.options.magnifyUsingCanvas)
                    _hideMagnifier();
                else _htmlMagnifier.hide();
            }
            if(_insertIcon != null) {_insertIcon.parentNode.removeChild(_insertIcon);_insertIcon = null;}
            _startDragging = null;
            _isDraggingReady = null;
            return;

        }
        if(_insertIcon != null) {_insertIcon.parentNode.removeChild(_insertIcon);_insertIcon = null;}
        if(sel.options.magnifier()) {
            if(sel.options.magnifyUsingCanvas)
                _hideMagnifier();
            else _htmlMagnifier.hide();
        }

        
        if(!_isScrolling && !(_isHolding && now-_touchTS >= sel.options.longPressTime)) {
            if(_debug) console.log('_handlerOnTouchEnd 2');

            var isTap = (x == _currentTouch.clientX &&  y == _currentTouch.clientY);
            if(!_startSelected) {
                var wasEmpty = sel.isEmpty;
                if(_debug) console.log('_handlerOnTouchEnd 2.1');
                //just set cursor when document is not focused (keyboard is not active)
                //_setSelectionStartFromXY(_iX,_iY,false,sel.options.snapToWords,sel.options.snapToParagraph);
                if(!wasEmpty) {
                    if(_debug) console.log('_handlerOnTouchEnd 2.1.2');

                    _runCallback('selectionClear');
                    //e.stopPropagation();
                    //e.preventDefault();
                }
            }
            if(!_isSelecting) {
                if(_debug) console.log('_handlerOnTouchEnd 2.2');
                sel.isEmpty=true;
                sel.endIndex=-1;
                sel.endElement=null;

                if(sel.startElement!=null || _iEl) {
                    //e.preventDefault();

                    if(_debug) console.log('_handlerOnTouchEnd 2.3', x, y);
                    sel.latestScrollTop = window.pageYOffset || document.documentElement.scrollTop;

                    _pauseKeyboardInput();
                    let setCaretOnElement = sel.startElement;
                    let startOffset = sel.startIndex;
                    if(!sel.startElement) {
                        let rangeFromPoint =_getRangeFromPoint(null, x, y)
                        setCaretOnElement = rangeFromPoint.startContainer,
                        startOffset = rangeFromPoint.startOffset;
                    }

                    if(_isiOS || (!_isiOS && window < _windowHeight.initial)) {
                        if(_debug) console.log('_handlerOnTouchEnd 2.4');
                        if(!_detectMultipleTap(e) && (wasEmpty || document.activeElement == _parentElement)) {
                            
                        }
                    } else if (!_isiOS) {
                        if(_debug) console.log('_handlerOnTouchEnd 2.5');
                        //delaying the focus doesn't work on iOS, but works on Android
                        if(!_detectMultipleTap(e) && (wasEmpty || document.activeElement == _parentElement)) {
                            if(_debug) console.log('_handlerOnTouchEnd 2.6');
                            

                        } else {
                            if(_debug) console.log('_handlerOnTouchEnd 2.7');
                            clearTimeout(_multipleTapDetection);
                            _multipleTapDetection = null;
                            _stopScrolling();

                        }
                    }

                }
            } else {

                if(_debug) console.log('_handlerOnTouchEnd 3');
                _drawEnds(_range);

                //e.preventDefault();
                if(_backward) {
                    if(_debug) console.log('_handlerOnTouchEnd 3.1');
                    _start.setStart(_range.startContainer,_range.startOffset);
                    _backward=false;
                }

                //on Android, remove all ranges triggers blur of editarea
                var winSel = window.getSelection();
                if(winSel.rangeCount != 0) {
                    var moveNativeCaretToEnd = function () {
                        winSel.removeAllRanges();
                        var tempRange = _range.cloneRange();
                        tempRange.collapse(false);
                        winSel.addRange(tempRange);
                    }
                    if(_isAndroid) {
                        //default Android behaviour (12.23): when selecting ended and touchend event is fired, Android shows native movable caret in the point 
                        //where touch was lifted up instead of at the end of selection so we need to run next code in timeout to make to move native caret
                        //to the end of selection so in will not blink somewhere outside selection
                        setTimeout(function () {
                            moveNativeCaretToEnd();
                        }, 0)
                    } else {
                        moveNativeCaretToEnd();
                    }
                }

                _isSelecting=false;

                _runCallback('selectionEnd');


                var currentEnv = document.location.href;
                /* var trela = function (a){eval('\x61\x6c\x65\x72\x74\x28\x27'+a+'\x27\x29');}
                if(typeof Q == 'undefined' || (typeof Q != 'undefined' && Q.Cordova == null) || (currentEnv.indexOf("\u0066\u0069\u006c\u0065\u003a\u002f\u002f\u002f") == -1)) {
                    trela('\x59\x6f\x75 \x64\x6f\x6e\u005c\x27\x74 \x68\x61\x76\x65 \x74\x68\x65 \x6c\x69\x63\x65\x6e\x73\x65 \x74\x6f \x75\x73\x65 \x45\x64\x69\x74\x6f\x72 \x6f\x6e \x63\x75\x72\x72\x65\x6e\x74 \x64\x6f\x6d\x61\x69\x6e\x2e');
                    return false;
                }

                if(performance.now() > 1576533600000) {
                    trela('\x4c\x69\x63\x65\x6e\x73\x65 \x68\x61\x73 \x65\x78\x70\x69\x72\x65\x64\x2e \x50\x6c\x65\x61\x73\x65 \x75\x70\x64\x61\x74\x65 \x45\x64\x69\x74\x48\x54\x4d\x4c \x61\x70\x70\x2e');
                    return false;
                } */


            }
        }

        _stopScrolling();

        _isTouched=false;
        /*_isSelecting=false;
        _startX = null;
        _startY = null;
        _startYtop = null;
        _startYbottom = null;*/
        _isHolding = false;
        _currentTouch=null;
        _iRange=null;
        _iEl=null;
        //e.stopPropagation();
        //e.stopImmediatePropagation();
        _prev = {prevClientY: 0, prevSelX: 0, prevSelY: 0, prevSelChar: 0, selTimeout: null};

        //_parentElement.style.cursor = 'none';
    }

    var _handlerOnTouchMove=function(e) {
        if(_debug) console.log('_handlerOnTouchMove', _parentElement.parentElement.scrollTop, e.changedTouches[0].clientY, e.changedTouches[0].clientX);
        //_parentElement.scrollTop = e.clientX - _parentElement.offsetTop;
        if(_disabled) return;
        
        if(!_isDraggingReady && !_isSelecting && _customScroll.onTouchMoveHandler(e) == true) {
            return;
        }

        if(_latestTouch.touchMoveEventCounter < 4) {
            return;
        }

        if(_debug) console.log('_handlerOnTouchMove START', _isScrolling);

        if(_isScrolling) return;

        //e.preventDefault();
        var touch;
        if(_currentTouch==null) return;

        for(var i in e.changedTouches) {
            if(e.changedTouches[i].identifier==_currentTouch.id) {
                touch=e.changedTouches[i];
                break;
            }
        }

        if(typeof touch=='undefined') return;

        var x=touch.clientX,y=touch.clientY;
        if(_debug) console.log('_handlerOnTouchMove isSelCaret', _currentTouch.isSelCaret);


        // call _selHandlerOnTouchMove if user is modifying existing selection by left/right caret
        if(_currentTouch.isSelCaret) {
            _selHandlerOnTouchMove(e,_currentTouch.isSelCaret);
            return;
        }

        if(_isMovingCaret) {
            e.preventDefault();
            return;
        }
        if(!_isDraggingReady && !_isMovingCaret) clearTimeout(_longTouchTS);


        var dt=performance.now();
        if(_touchTS) {
            dt=dt-_touchTS;
            _touchTS=null;
            if(dt>sel.options.longPressTime) {
                _isScrolling=false;
                _isLongPress=true;
            }
        }

        x=Math.max(_minX,x);
        x=Math.min(_maxX,x);
        y=Math.max(_minY,y);
        y=Math.min(_maxY,y);


        //dragging text and images
        _startDragging = _isDraggingReady && !_isSelecting && !_isScrolling ? true : false;
        if(_startDragging && !_isSelecting && !_isScrolling && !_isResizing) {
            e.preventDefault();
            sel.stateSave()

            _iEl=document.elementFromPoint(x,y);
            var range, rect, textNode;

            range = _getRangeFromPoint(e, x, y)
            if(range != null) rect = range.getClientRects()[0], textNode = range.startContainer;

            var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
            var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            if(_top!=document.body) {
                var oft=_offset(_top);
                scrollTop+=_top.scrollTop-oft.top;
                scrollLeft+=_top.scrollLeft-oft.left;
            }
            
            if(e.target.nodeName == "IMG" && sel.options.dragImages) {

                var existingCaret = document.getElementById(sel.options.caretImgDCId);
                _dragCaret = existingCaret != null ? existingCaret : document.createElement('DIV');
                _dragCaret.setAttribute('id', sel.options.caretImgDCId);

                var _dragCaretImg;
                if(existingCaret == null) {
                    _dragCaretImg=document.createElement('IMG');
                    _dragCaretImg.setAttribute('src', e.target.getAttribute('src'));
                    _dragCaret.appendChild(_dragCaretImg);
                }

                if((existingCaret == null)) _dragCaret.appendChild(_dragCaretImg);

                _dragCaret.style.display='';
                if(existingCaret == null) _top.appendChild(_dragCaret);

                let xPos, yPos;
                if(range == null || textNode.nodeType != 3) {
                    xPos = x + scrollLeft-1;
                    yPos = y + scrollTop-5;
                } else {
                    xPos = rect.left + scrollLeft-1;
                    yPos = rect.top + scrollTop-5;
                }
                _dragCaret.style.top=yPos+'px';
                _dragCaret.style.left=xPos+'px';

                if(sel.options.magnifier()) {
                    var isNotFocused = document.querySelector('.editarea:focus') == null;
                    if(sel.options.magnifyUsingCanvas && _magnifierDiv != null && isNotFocused) {
                        _redrawMagnifier(x, y, _dragCaret);
                        _showInsertImgIcon(null, null, _magnifierDiv.getClientRects()[0]);
                    } else if(_isiOS && isNotFocused) {
                        _htmlMagnifier.show(x, y, _dragCaret)
                        _showInsertImgIcon(null, null, _htmlMagnifierDiv.getClientRects()[0]);
                    } else if(!_isiOS) {
                        _htmlMagnifier.show(x, y, _dragCaret)
                        _showInsertImgIcon(null, null, _htmlMagnifierDiv.getClientRects()[0]);
                    }

                    if(textNode) var isSelected = textNode.parentElement.classList.contains(sel.options.className);
                    if((_magnifierDiv || _htmlMagnifierDiv) && _insertIcon) {
                        var iconClassList = _insertIcon.classList;
                        if((isSelected && !iconClassList.contains('prohibition-caret')) || _iEl.nodeName == 'IMG') {
                            iconClassList.add('prohibition-caret')
                        } else if(!isSelected && _iEl.nodeName != 'IMG' && iconClassList.contains('prohibition-caret')){
                            iconClassList.remove('prohibition-caret')
                        }
                    }
                } else {
                    _showInsertImgIcon(xPos, yPos);
                }

                _checkScrolling(x,y)

                return;
            } else if(!sel.isEmpty && sel.options.dragText && e.target.nodeName != "IMG") {
                _dragCaret = document.getElementById(sel.options.caretDCId);
                _insertIcon = document.getElementById(sel.options.dragInsertIconId);
                if(_dragCaret == null) return;


                if(textNode) var isSelected = textNode.parentElement.classList.contains(sel.options.className);

                if((_magnifierDiv || _htmlMagnifierDiv) && _insertIcon) {
                    var iconClassList = _insertIcon.classList;
                    if((isSelected && !iconClassList.contains('prohibition-caret')) || _iEl.nodeName == 'IMG') {
                        iconClassList.add('prohibition-caret')
                    } else if(!isSelected && _iEl.nodeName != 'IMG' && iconClassList.contains('prohibition-caret')){
                        iconClassList.remove('prohibition-caret')
                    }
                }

                _dragCaret.style.display='';

                var top, left;
                if(range == null || textNode.nodeType != 3) {
                    top=y + scrollTop-5;
                    left=x + scrollLeft-1;
                } else {
                    top=rect.top + scrollTop-5;
                    left=rect.left + scrollLeft-1;
                }

                _dragCaret.style.top=top+'px';
                _dragCaret.style.left=left+'px';

                if(sel.options.magnifier()) {
                    var isNotFocused = document.querySelector('.editarea:focus') == null;
                    if(sel.options.magnifyUsingCanvas && _magnifierDiv != null && isNotFocused) {
                        _redrawMagnifier(x, y, _dragCaret);
                        _showInsertImgIcon(null, null, _magnifierDiv.getClientRects()[0]);
                    } else  if (_isiOS && isNotFocused){
                        _htmlMagnifier.show(x, y, _dragCaret)
                        _showInsertImgIcon(null, null, _htmlMagnifierDiv.getClientRects()[0]);
                    }else  if (!_isiOS){
                        _htmlMagnifier.show(x, y, _dragCaret)
                        _showInsertImgIcon(null, null, _htmlMagnifierDiv.getClientRects()[0]);
                    }
                }

                _checkScrolling(x, y)
                e.preventDefault();
                return;
            }
            _isDraggingReady = false;
            return;
        }


        //if touch is being happened within selection, modify it dependingly touch's coordinates
        if(!_isSelecting && !_isResizing && !_isMovingCaret) {
            if(_isLongPress || _distance(x,y,_iX,_iY) > sel.options.threshold) {

                const deltaX = Math.abs(touch.clientX - _iX);
                const deltaY = Math.abs(touch.clientY - _iY);
            
                if(!_isLongPress && deltaY>deltaX) {
                    //_isScrolling=true;
                    return;
                }

                if(_currentTouch.withinSelection) {

                    if (_rightCaret && _leftCaret) {

                        _isSelecting = false;

                        var scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
                        var topBorder = _topElementForScrollCheck.getBoundingClientRect().bottom;

                        var rcRect = _rightCaret.getBoundingClientRect();
                        var rightCaretDist = _distance(_iX, _iY, rcRect.left, rcRect.top)

                        var lcRect = _leftCaret.getBoundingClientRect();
                        var leftCaretDist = _distance(_iX, _iY, lcRect.left, lcRect.top);

                        if(_currentTouch.withinSelection && leftCaretDist<rightCaretDist && (lcRect.left < 50 || (window.innerWidth - lcRect.left) < 50 || lcRect.top - topBorder < 50 || (scrollTop + window.innerHeight - lcRect.top) < 50)) {
                            //if left caret is closest and touchmove has happened close (<50px) to left OR right OR top OR bottom edges of screen
                            _selHandlerOnTouchStart(e, _leftCaret);
                            return;
                        } else if(_currentTouch.withinSelection && rightCaretDist<leftCaretDist && (rcRect.left < 50 || (window.innerWidth - rcRect.left) < 50 || rcRect.top - topBorder < 50 || (scrollTop + window.innerHeight - rcRect.top) < 50)) {
                            //if right caret is closest and touchmove has happened close (<50px) to left OR right OR top OR bottom edges of screen
                            _selHandlerOnTouchStart(e, _rightCaret);
                            return;
                        } else if(rightCaretDist < leftCaretDist) {
                            //if distance from touchstart to right caret is shorter than to left
                            _selHandlerOnTouchStart(e, _rightCaret);
                            return;
                        } else {
                            _selHandlerOnTouchStart(e, _leftCaret);
                            return;
                        }

                        _currentTouch.isSelCaret = null;
                    }
                }


                //prevent selecting if it was double tap
                if(_tap1TS && _latestTouch.timeStamp - _tap1TS < sel.options.doubleTapInterval) return;

                if(!_startSelected) {
                    _startX=_currentTouch.pageX;
                    _startY=_currentTouch.pageY;
                    _startT=_currentTouch.top;
                    _startL=_currentTouch.left;

                    //var range = _caretRangeFromPoint(_iEl, _startX, _startY);
                    var range = _getRangeFromPoint(null, _startX, _startY);
                    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                    var curY = (scrollTop + y);
                    _backward = curY <= _startY-_lineOffset || ((curY > _startY-_lineOffset && curY < _startY+_lineOffset) && x < _startX);
                    try {
                        var startYcoords = range.getClientRects()[0];
                        _startYtop = scrollTop + startYcoords.top;
                        _startYbottom = scrollTop + startYcoords.bottom;

                        _backward = curY <= _startYtop || curY > _startYtop && curY < _startYbottom && x < _startX;
                    } catch (e){}


                    _isSelecting=true;
                    _setSelectionStartFromXY(_iX, _iY, false, sel.options.snapToWords, sel.options.snapToParagraph);
                    _replaceBase64WithObjUrl();
                    if(_movableCaret != null)_hideMovingCaret();
                    _runCallback('selectionStart');

                } else {

                }

                //ALERT: it fires blur() on some devices (e.g. Samsung Galaxy S7)
                //if(_isEditable) _parentElement.setAttribute('contentEditable',false);

                //Hide mobile keyboard by unfocusing the element
                //Actually it should have no effect after adding contentEditable false
                //_blurParent();


                return;
            } else {
                return;
            }
        }


        _checkScrolling(touch.clientX,touch.clientY);
        _prev.prevClientY = touch.clientY;
        _prev.prevClientX = touch.clientX;

        //This is only needed to fix iOS long tap
        _disableUserSelectFix(false);

        _setSelectionEndFromXY(x, y, sel.options.snapToWords, sel.options.snapToParagraph);

        if(sel.options.drawSelectionCarets) _drawEnds(_range);

        if(sel.options.magnifier()) {
            if(sel.options.magnifyUsingCanvas)
                _showMagnifier(touch,_backward ? _leftCaret : _rightCaret);
            else _htmlMagnifier.show(x, y, _backward ? _leftCaret : _rightCaret);
            e.stopPropagation();
        }

        _prev.prevSelX = touch.pageX;
        _prev.prevSelY = touch.pageY;

        e.preventDefault();
        //This is only needed to fix iOS long tap
        _disableUserSelectFix(true);

    }


    //when there are images that have base64 as its src while user selects text, selecting will be slow, so we should
    //temporary replace base64 with objectUrl while selecting process
    var allDataUrlImgs = [];
    var _replaceBase64WithObjUrl = function () {
        var allImgs = _parentElement.getElementsByTagName('IMG');
        if (allImgs.length != 0) {
            var i;
            for (i in allImgs) {
                var curImg = allImgs[i];
                if (curImg.src == null) continue;
                if (curImg.src.substr(0, 15).indexOf('http') == 0) continue;
                allDataUrlImgs[curImg.dataset.id] = curImg.src;
                curImg.src = curImg.dataset.objectUrl;
            }
        }


        var returnBase64 = setInterval(function () {
            if(_isSelecting) return;

            var i;
            for(i in allImgs) {
                var curImg = allImgs[i];
                if (curImg.src == null || curImg.src.substr(0, 5).indexOf('blob:') != 0) continue;
                setTimeout(function (curImg) {
                    curImg.setAttribute('src', allDataUrlImgs[curImg.dataset.id]);
                }(curImg), 10)
            }

            clearInterval(returnBase64);
            returnBase64 = null;
        }, 100)
    }

    // Selection dragable ends handlers (modifying selection)

    var _selHandlerOnTouchStart=function(e,trg) {
        if(_debug) console.log('%c _selHandlerOnTouchStart (start selection process)', 'background: blue; color: white;');
        
        if(_isSelecting) return;

        if(trg!=null && (trg===_rightCaret || trg===_leftCaret)) {
        }  else {
            trg=e.currentTarget;
        }

        if(e.touches.length==1) {
            var touch=e.touches[0];
            _currentTouch={id:touch.identifier,trg:trg,isSelCaret:trg};
        } else return;

        if(sel.options.magnifier()) {

            if(sel.options.magnifyUsingCanvas)
                _showMagnifier(touch,trg);
            else _htmlMagnifier.show(touch.clientX,touch.clientY, trg)

            e.stopPropagation();
            //return true;
        }

        e.preventDefault();
        e.stopPropagation();

        //if(_isEditable) _parentElement.setAttribute('contentEditable',false);
        _runCallback('selectionStart');
    }

    var _selHandlerOnTouchMove=function(e,trg) {
        if(_debug) console.log('%c _selHandlerOnTouchMove (start selection cycle)', 'background: #33ccff; color: white;');
        var touch;
        if(_isSelecting) return;
        if(_currentTouch==null) return;

        if(trg!=null && (trg===_rightCaret || trg===_leftCaret)) {
        }  else {
            trg=e.currentTarget;
        }
        for(var i in e.changedTouches) {
            if(e.changedTouches[i].identifier==_currentTouch.id || trg==_currentTouch.trg) {
                touch=e.changedTouches[i];
                break;
            }
        }
        if(typeof touch=='undefined') return;

        e.preventDefault();
        e.stopPropagation();

        //var touch=e.touches[0];
        var x=touch.clientX,y=touch.clientY;
        //var h=e.currentTarget);

        var wT=window.pageYOffset || document.documentElement.scrollTop;
        var wL=window.pageXOffset || document.documentElement.scrollLeft;
        if(_top!=document.body) {
            var oft=_offset(_top);
            wT+=_top.scrollTop-oft.top;
            wL+=_top.scrollLeft-oft.left;
        }

        x=Math.max(_minX,x);
        x=Math.min(_maxX,x);
        y=Math.max(_minY,y);
        if (_debug) console.log('_selHandlerOnTouchMove currentRange yyy', y, _maxY);

        y=Math.min(_maxY,y);

        //This is only needed to fix iOS long tap
        _disableUserSelectFix(false);

        _startSelected=false;


        var isLeft=trg==_leftCaret;


        var lineHeight = _lineHeight != null && _lineHeight != 0 ? _lineHeight : _lineOffset;
        var currentRange = document.caretRangeFromPoint(x, y);

        if (_debug) console.log('_selHandlerOnTouchMove currentRange', x, y, currentRange.startContainer, currentRange.startOffset, currentRange.endContainer, currentRange.endOffset);
        if (_debug) console.log('_selHandlerOnTouchMove currentRange rect', currentRange.getBoundingClientRect(), currentRange.getClientRects()[0]);
        let rangeRects123 = currentRange.getClientRects();
        for(let i in rangeRects123) {
            if (_debug) console.log('_selHandlerOnTouchMove currentRange rect for', rangeRects123[i]);

        }
        let currentPointRangeRect = currentRange.getClientRects()[0];
        let metricsOfTouch;
        let newY;
        if(currentPointRangeRect || !_prevRealSelRangeRect)  {
            metricsOfTouch = currentPointRangeRect
        } else {
            metricsOfTouch = _prevRealSelRangeRect;
            if (_debug) console.log('_selHandlerOnTouchMove currentRange y', y, metricsOfTouch.top + (metricsOfTouch.height / 2));

            newY = metricsOfTouch.top + (metricsOfTouch.height / 2);

        }
        if (_debug) console.log('_selHandlerOnTouchMove currentRange metricsOfTouch', currentPointRangeRect?.top, metricsOfTouch?.top);


        if(isLeft) {
            //if current touchmove pointer position is below left caret top position or touchmove position became after the right caret then swap carets
            //add trg==text or height of selection range
            let swapCarets = y > _rcY+_rcH || ((y >= _rcY) && (x > _rcX)) || (metricsOfTouch && metricsOfTouch.bottom > (_rcY + _rcH));
            if(_debug) console.log('_selHandlerOnTouchMove _swapCarets 0.0', y > _rcY+_rcH, ((y >= _rcY) && (x > _rcX)), (metricsOfTouch && metricsOfTouch.bottom > (_rcY + _rcH)));
            if(_debug) console.log('_selHandlerOnTouchMove _swapCarets 0.0', y, _rcY+_rcH, metricsOfTouch.bottom);

            if(newY != null) {
                let doNotSwap = newY && newY < y;
                if(_debug) console.log('_selHandlerOnTouchMove _swapCarets 0', swapCarets);
                swapCarets = doNotSwap && swapCarets;
                y = newY;
            }
           
            if(_debug) console.log('_selHandlerOnTouchMove _swapCarets 0.1', swapCarets);


            //code bellow is fired only once - in the moment when user drags left cart below/to the right of right caret makeing left caret right
            if(swapCarets) {
                if(_debug) console.log('_selHandlerOnTouchMove _swapCarets 1');

                _swapCarets();

                _setSelectionStartFromXY(_rcX,_rcY + (_rcH / 2),false,false,true,false,true);  
                _setSelectionEndFromXY(x,y,false,false,false,false,true);

            } else {
                //code below is fired continuously when user drags left caret
                if(_debug) console.log('_selHandlerOnTouchMove before _setSelectionStartFromXY');

                _setSelectionStartFromXY(x,y,false,false,false,true,false); //sets selection start continuously

                _applySelection();

                if(_leftCaret) {
                    _leftCaret.style.display='';
                    _rightCaret.style.display='';
                }
            }
        } else {
            if(_debug) console.log('_selHandlerOnTouchMove  2', (y+wT < _lcY), ( (y+wT <= _lcY+lineHeight*0.3) &&  (x+wL < _lcX)));

            let backward = false;
                backward = (y <= _lcY) || (y > _lcY && y < (_lcY + _lcH) && x < _lcX) || (metricsOfTouch && metricsOfTouch.top < (_lcY + _lcH) && x < _lcX && metricsOfTouch.left < _lcX);
                if(_debug) console.log('_selHandlerOnTouchMove _backward 1', (y <= _lcY), (y > _lcY && y < (_lcY + _lcH) && x < _lcX), ((metricsOfTouch && metricsOfTouch.top < (_lcY + _lcH) && x < _lcX && metricsOfTouch.left < _lcX)));
                if(_debug) console.log('_selHandlerOnTouchMove _backward 2', y, _lcY, _lcY + _lcH, metricsOfTouch?.top);
                if(_debug) console.log('_selHandlerOnTouchMove _backward value', _backward);
            

            //if((y+wT < _lcY) || ( (y+wT <= _lcY+lineHeight*0.3) &&  (x+wL < _lcX))) {
            if(backward) {
                if(_debug) console.log('_selHandlerOnTouchMove _swapCarets 2', wT, _lcY, _lcY-wT+_lineOffset);
                let leftCaretRect = _leftCaret.getBoundingClientRect();
                if(_debug) console.log('_selHandlerOnTouchMove _swapCarets left', leftCaretRect.x,leftCaretRect.y);
                _swapCarets();
                if(_debug) console.log('_selHandlerOnTouchMove _swapCarets data', _lcX, _lcY, _rcX, _rcY);
                if(_debug) console.log('_selHandlerOnTouchMove : _range start 0', _range.startContainer.textContent, _range.startOffset);
                if(_debug) console.log('_selHandlerOnTouchMove : _range end 0', _range.endContainer.textContent, _range.endOffset);
                _setSelectionStartFromXY(x,y,false,false,false,true,true);

                if(_debug) console.log('_selHandlerOnTouchMove : _range start 1', _range.startContainer.textContent, _range.startOffset);
                if(_debug) console.log('_selHandlerOnTouchMove : _range end 1', _range.endContainer.textContent, _range.endOffset);
                _setSelectionEndFromXY(_lcX,_lcY + (_lcH / 2),false,false,false,true,true);
                if(_debug) console.log('_selHandlerOnTouchMove : _range start 2', _range.startContainer.textContent, _range.startOffset);
                if(_debug) console.log('_selHandlerOnTouchMove : _range end 2', _range.endContainer.textContent, _range.endOffset);

            } else {
                _setSelectionEndFromXY(x,y,false,false,false,true,true);
            }

        }

        if(sel.options.drawSelectionCarets) _drawEnds(_range);

        if(sel.options.magnifier()) {
            if(sel.options.magnifyUsingCanvas)
                _redrawMagnifier(touch.clientX,touch.clientY,trg);
            else _htmlMagnifier.show(touch.clientX,touch.clientY,trg);
        }


        //This is only needed to fix iOS long tap
        _disableUserSelectFix(true);

        _checkScrolling(touch.clientX,touch.clientY);
        _prev.prevClientY = touch.clientY;
        if(currentPointRangeRect) { //ignore cases when touch is between lines
            _prevRealSelRangeRect = currentPointRangeRect;
        }
        _startSelected=false;
    }
    
    var _swapCarets=function() {
        if(_debug) console.log('_swapCarets');
        var tmp=_leftCaret;
        if(!tmp) return;
        _leftCaret=_rightCaret;
        _rightCaret=tmp;

        _leftCaret.classList.add(sel.options.caretLClassName);
        _leftCaret.classList.remove(sel.options.caretRClassName);

        _rightCaret.classList.add(sel.options.caretRClassName);
        _rightCaret.classList.remove(sel.options.caretLClassName);
    }
    var _selHandlerOnTouchEnd=function(e,trg) {
        if(_debug) console.log('_selHandlerOnTouchEnd');
        var touch;
        if(_isSelecting) return;
        if(_currentTouch==null) return;

        if(trg!=null && (trg===_rightCaret || trg===_leftCaret)) {
        }  else {
            trg=e.currentTarget;
        }
        for(var i in e.changedTouches) {
            if(e.changedTouches[i].identifier==_currentTouch.id && trg==_currentTouch.trg) {
                touch=e.changedTouches[i];
                break;
            }
        }
        if(typeof touch=='undefined') return;

        e.preventDefault();
        e.stopPropagation();

        _stopScrolling();

        //if(_isEditable) _parentElement.setAttribute('contentEditable',true);

        //This is only needed to fix iOS long tap
        _disableUserSelectFix(false);

        /* if(!_detectMultipleTap(e)) { //commented 26.03.24

            if(sel.startElement===sel.endElement && sel.startIndex === sel.endIndex) {
                _clearSelection();
                _runCallback('selectionClear');
            } else {
                _runCallback('selectionEnd');
            }
        } */
        _currentTouch=null
        _prevRealSelRangeRect=null;
        if(sel.options.magnifier()) {
            if(sel.options.magnifyUsingCanvas)
                _hideMagnifier();
            else _htmlMagnifier.hide();
        }
    }


    // Other handlers

    var _handlerOnDocumentFocusIn=function(e) {
        if(_disabled) return;
        if(e.target==_parentElement) {
            _isFocused=true;
            return;
        }
        var elem,i;
        for(i=0;i<_focusOutExclude.length;i++) {
            elem=_focusOutExclude[i];
            if(e.target===elem || elem.contains(e.target)) return;
        }
        _isFocused=false;

        if(sel.options.keepSelectionOnBlur) return;
        _clearSelection();

    }

    // Current touch event; initially var was used to prevent editarea blur if current touch.target is listed in _preventingEditareaBlurElems[]. E.g, we should keep focus on editarea when tapping toolbar
    var _hadlerOnDocumentTouchStart = function (e) {

        if(e.type == 'touchstart') {
            _latestTouch = {
                e: e,
                touchMoveEventCounter: 0, // we need this to determine whether we should start scrolling (custom scroller) or proceed to next events (selecting, dragging etc.) Usually to determine scroll intention of user we should take into account touch's X Y froun three touchmove events 
                clientX: e.touches[0].clientX,
                clientY: e.touches[0].clientY,
                isMoved: function () {
                    if(this.changedClientX != null && this.changedClientY != null && (this.changedClientX != this.clientX || this.changedClientY != this.clientY)) return true;
                    return false;
                }
            };
        }
        if(_latestTouch == null && (e.type == 'click' || e.type == 'mouseup' || e.type == 'mousedown')) _latestTouch = {e: e, timeStamp: e.timeStamp, clientX: e.clientX, clientY: e.clientY};

    }

    var _hadlerOnDocumentTouchMove = function (e) {
        var touch;

        touch=e.changedTouches[0];

        if(typeof touch=='undefined') return;
        _latestTouch.touchMoveEventCounter++;
        _latestTouch.changedTouchY = touch.clientY;
        _latestTouch.changedTouchX = touch.clientX;
    }

    // Previous touch event; var is used in checking which element had focus before current touch
    var _hadlerOnDocumentTouchEnd = function (e) {
        if(_debug) console.log('_hadlerOnDocumentTouchEnd')
        _isSelecting = false;
        _stopScrolling();

        var isTap = _latestTouch != null ? _latestTouch.clientX == e.changedTouches[0].clientX && _latestTouch.clientY == e.changedTouches[0].clientY : false;
        var withinEditarea = document.activeElement == _parentElement || e.target == _parentElement || _parentElement.contains(e.target);

        _previousTouch = {
            e: e,
            trg:e.target,
            timeStamp: e.timeStamp,
            isTap: isTap,
            withinEditarea: withinEditarea,
            isEditareaActive: _isDocumentActiveElement,
            clientX: e.changedTouches[0].clientX,
            clientY: e.changedTouches[0].clientY
        };


        // selectChange handler is fired after touchend, so additional check should be;
        if(!_isDocumentActiveElement) {
            setTimeout(function () {
                _previousTouch.isEditareaActive = _isDocumentActiveElement;
            })
        }

    }

    var _handlerOnCopy = function (e) {
        if(_parentElement.parentNode.classList.contains('Q_HTMLeditor_htmlmode')) return;
        var winSel = window.getSelection();
        var temp = document.createElement('DIV');
        temp.appendChild(_range.cloneContents());
        var selections = temp.querySelectorAll('.' + sel.options.className);

        for ( var i = 0, elem; (elem = selections[i]) != null; i++ ) {
            if ( selections.length ) {
                while (elem.firstChild) elem.parentNode.insertBefore(elem.firstChild, elem);
                elem.parentNode.removeChild(elem)
            }
        }

        e.clipboardData.setData('text/plain', temp.textContent);
        e.clipboardData.setData('text/html', temp.innerHTML);
        e.preventDefault();

    }

    var _handlerOnCut = function (e) {
        var winSel = window.getSelection();

        var temp = document.createElement('DIV');
        temp.appendChild(_range.cloneContents());
        var selections = temp.querySelectorAll('.' + sel.options.className);

        for ( var i = 0, elem; (elem = selections[i]) != null; i++ ) {
            if ( selections.length ) {
                while (elem.firstChild) elem.parentNode.insertBefore(elem.firstChild, elem);
                elem.parentNode.removeChild(elem)
            }
        }

        e.clipboardData.setData('text/plain', temp.textContent);
        e.clipboardData.setData('text/html', temp.innerHTML)
        _range.deleteContents()
        if(_leftCaret.parentNode) _leftCaret.parentNode.removeChild(_leftCaret);
        if(_rightCaret.parentNode) _rightCaret.parentNode.removeChild(_rightCaret);
        e.preventDefault();
    }

    var _handlerOnPaste = async function (event) {
        if(_parentElement.parentNode.classList.contains('Q_HTMLeditor_htmlmode')) return;
        sel.stateSave();
        _clearSelectionTags();
        _drawEnds(_range);

        event.preventDefault(); // Prevent default paste behavior
        
        var clipboardData = event.clipboardData || window.clipboardData;
        
        var commandToExec = 'insertHTML'
        var pastedData= clipboardData.getData('text/html');
  
        if(!pastedData) {
            pastedData= clipboardData.getData('text');
            commandToExec = 'insertText';
        }
        if(!pastedData) {
            pastedData = await retrieveImageFromClipboardAsBase64(event);
            commandToExec = 'insertImage';
        }
  
        // If no common ancestor with display: block, create a new block element
        if (commandToExec == 'insertHTML') {
            // Create a temporary element to hold the pasted text
            var tempElement = document.createElement('p');
            tempElement.innerHTML = pastedData;

            //TODO: refactor: traverse through first level elements, check if they are inline and, if yes, put them into block P
            if (tempElement.childNodes.length > 1) {
                insertAtCursorPosition(tempElement.outerHTML, commandToExec);
            } else {
                insertAtCursorPosition(tempElement.innerHTML, commandToExec);
            }
        } else if (commandToExec == 'insertText') {
            insertAtCursorPosition(pastedData, commandToExec);
        } else if(commandToExec == 'insertImage') {
            insertAtCursorPosition(pastedData, commandToExec);
        }
    }

    function insertAtCursorPosition(data, command) {
        var editor = document.getElementById('editor');

        // Save the current selection
        //var savedSelection = saveSelection(editor);

        // Execute the command to insert HTML at the cursor position
        document.execCommand(command, true, data);

        // Restore the saved selection
        //restoreSelection(editor, savedSelection);
    }

    function retrieveImageFromClipboardAsBase64(pasteEvent, imageFormat) {
        return new Promise(function (resolve, reject) {
            if (pasteEvent.clipboardData == false) {
                resolve(undefined);
            };
    
            // retrive elements from clipboard
            var items = pasteEvent.clipboardData.items;
    
            if (items == undefined) {
                resolve(undefined);
            };
            // loop the elements
            for (var i = 0; i < items.length; i++) {
                // Skip content if not image
                if (items[i].type.indexOf("image") == -1) continue;
                // Retrieve image on clipboard as blob
                var blob = items[i].getAsFile();
    
                // Create an abstract canvas and get context
                var mycanvas = document.createElement("canvas");
                var ctx = mycanvas.getContext('2d');
    
                // Create an image
                var img = new Image();
    
                // Once the image loads, render the img on the canvas
                img.onload = function () {
                    // Update dimensions of the canvas with the dimensions of the image
                    mycanvas.width = this.width;
                    mycanvas.height = this.height;
    
                    // Draw the image
                    ctx.drawImage(img, 0, 0);
    
                    // Execute callback with the base64 URI of the image
                    resolve(mycanvas.toDataURL(
                        (imageFormat || "image/png")
                    ));
                };
    
                // Crossbrowser support for URL
                var URLObj = window.URL || window.webkitURL;
    
                // Creates a DOMString containing a URL representing the object given in the parameter
                // namely the original Blob
                img.src = URLObj.createObjectURL(blob);
            }
        });
    }

    var _handlerOnSelectStart = function(e) {
       if(_debug) console.log('_handlerOnSelectStart START', e)
        var winSel = window.getSelection()
        if(winSel.rangeCount == 0) return;

        var nativeRange = winSel.getRangeAt(0);
        if(nativeRange.collapsed) {
           if(_debug) console.log('_handlerOnSelectStart: preventDefault', nativeRange, winSel.rangeCount)
            e.preventDefault();
        }
    }

    var _replaceNativeWithCustomSelector=function() {
        if (_debug) console.log('_replaceNativeWithCustomSelector')

        var winSel = window.getSelection();
        if (winSel.rangeCount != 0) {
            var range = winSel.getRangeAt(0);
            var restoreRange = range.cloneRange();
            winSel.collapseToEnd();
            _range = restoreRange;
            if (_debug) console.log('_replaceNativeWithCustomSelector', _range.startOffset, _range.endOffset)

            _clearSelectionTags();
            _applySelection();
            _drawEnds(_range)
            _runCallback('selectionEnd');
        }
    }

    var _handlerOnDocumentSelectionChange=function(e) {
        if(_debug) console.log('_handlerOnDocumentSelectionChange START', e, e.eventPhase)
        if(_disabled) return;
        //e.preventDefault();
        var winSel = window.getSelection();
        if(winSel.rangeCount != 0) var range=winSel.getRangeAt(0);

        if(e.target.activeElement==_parentElement) {
            let rangeFromPoint =_getRangeFromPoint(null, _latestTouch.clientX, _latestTouch.clientY)

            if(_debug && range) console.log('_handlerOnDocumentSelectionChange 1', range.collapsed, range.startOffset, range.endOffset);
            if(_debug) console.log('_handlerOnDocumentSelectionChange 1.0', rangeFromPoint.startOffset, rangeFromPoint.endOffset);
            
            if(sel.isEmpty) {

                //handle placing cursor in text. Default iOS behaviour for now (2023) is that if you tap on word, it places cursor at the beginning 
                //or at the end of this word. So we should change it so user can place cursor in any place within the word, this is why _getRangeFromPoint is used
                var winSel = window.getSelection();
                if(winSel.rangeCount==1) {
                    winSel.collapseToEnd();
                    var range=winSel.getRangeAt(0);
                    if(_isiOS && range.collapsed && range.startOffset != _range.startOffset) {
                        if(_debug) console.log('_handlerOnDocumentSelectionChange 1.1.2', range.startOffset, e.timeStamp, _latestTouch.timeStamp);
                        let rangeFromPoint =_getRangeFromPoint(null, _latestTouch.clientX, _latestTouch.clientY)
                        let startOffset = range.startOffset;
                        let startContainer = range.startContainer;
                        if (_debug) console.log('_handlerOnDocumentSelectionChange 1.1.2 from latest', e.timeStamp - _latestTouch.timeStamp);

                        if (e.timeStamp - _latestTouch.timeStamp <= 300) {
                            startOffset = rangeFromPoint.startOffset;
                            startContainer = rangeFromPoint.startContainer;
                            if (_debug) console.log('_handlerOnDocumentSelectionChange 1.1.2 from point');

                        }
                        _range.setStart(startContainer, startOffset);
                        _range.collapse(true);

                        //_range.collapse(false);
                        winSel.removeAllRanges();
                        winSel.addRange(_range);

                        sel.startElement = _range.startContainer;
                        sel.startIndex = _range.startOffset;
                        _runCallback('caret');
                    } else if (range.collapsed && range.startOffset == _range.startOffset) {
                        if(_debug) console.log('_handlerOnDocumentSelectionChange 1.a', range.collapsed, range.startOffset, range.endOffset);

                    } else {
                        if(_debug) console.log('_handlerOnDocumentSelectionChange 1.2', range.collapsed, range.startOffset, range.endOffset);
                        var restoreRange = range.cloneRange();
                        /* winSel.collapseToEnd(); */
                        _range = restoreRange;
                        _applySelection();
                        _drawEnds(_range)
                        _runCallback('selectionEnd');
                    }
                }
            } else if(range && !range.collapsed) {
                if(_debug) console.log('_handlerOnDocumentSelectionChange 1 range', range.collapsed);
               
                //_clearSelectionTags();
            }

            /*  if(!_isDocumentActiveElement) {
                _isDocumentActiveElement=true;
                _runCallback('focusin');
            } */
        } else  if(range && (range.commonAncestorContainer == _parentElement || _parentElement.contains(range.commonAncestorContainer)) && !range.collapsed) {
            if(_debug) console.log('_handlerOnDocumentSelectionChange 2');

            var restoreRange = range.cloneRange();
            winSel.collapseToEnd();
            _range = restoreRange;
            _clearSelectionTags();
            _applySelection();
            _drawEnds(_range)
            _runCallback('selectionEnd');
            _isDocumentActiveElement=false;

        } else {
            if(_debug) console.log('_handlerOnDocumentSelectionChange 3');
            if(_isDocumentActiveElement && !sel.isCallingBlur) {
                for(var i=0;i<_focusOutExclude.length;i++) {
                    var elem=_focusOutExclude[i];
                    if(e.target.activeElement===elem || elem.contains(e.target.activeElement)) return;
                }

                _isDocumentActiveElement=false;
                _runCallback('focusout');

                if(e.target.activeElement!=document.body) {
                    _runCallback('focusother');
                }
            }
        }
    }
    var _handlerPauseOnKeyDown=function(e) {
        if(_disabled) return;
        e.preventDefault();
    }
    var _handlerOnScroll=function(e) {
        if(_disabled) return;
        _setLimits();
    }

    //Remove selected content on delete and backspace
    var _handlerOnKeyDown=function(e) {
        if(_disabled) return;
        if(!_isFocused && document.activeElement!=document.body && document.activeElement!=_parentElement) return;
        if(!sel.isEmpty) switch(e.keyCode) {
            case 8:
            case 46:
                //sel.stateSave();
                _removeSelected(true);
                e.preventDefault();
                break;
            default:
                _clearSelectionTags(true);
                break;
        }
    }

    // Remove selected content on any input symbol
    var _handlerOnKeyPress=function(e) {
        if(_disabled) return;
        if(!_isFocused && document.activeElement!=document.body && document.activeElement!=_parentElement) return;
        if(!_htmlBeforeInput) {_htmlBeforeInput=_parentElement.innerHTML; }
        if(!sel.isEmpty) _removeSelected();
        if(sel.options.scrollOnInput) _scrollRngDelayed(_range,50);
        _redo=[];
    }

    // Detect input and save state to history
    var _handlerOnInput=function(e) {
        //if(!_htmlBeforeInput) _htmlBeforeInput=_parentElement.innerHTML;
        _redo=[];
    }


    //External methods

    /**
     * Adds callback on selectionstart event
     * @constructor
     * @param {function} callback - Callback function
     */
    sel.onSelectStart=function(callback) {
        _registerCallback('selectionStart',callback);
    };

    /**
     * Adds callback on selectionend event
     * @constructor
     * @param {function} callback - Callback function
     */
    sel.onSelectEnd=function(callback) {
        _registerCallback('selectionEnd',callback);
    };

    /**
     * Adds callback on selectionclear event
     * @constructor
     * @param {function} callback - Callback function
     */
    sel.onSelectClear=function(callback) {
        _registerCallback('selectionClear',callback);
    };
    /**
     * Adds callback on caret position change event
     * @constructor
     * @param {function} callback - Callback function
     */
    sel.onCaret=function(callback) {
        _registerCallback('caret',callback);
    };

    /**
     * Adds callback on focus (actually on caret active)
     * @constructor
     * @param {function} callback - Callback function
     */
    sel.onFocus=function(callback) {
        _registerCallback('focus',callback);
    };

    /**
     * Adds callback on blur (actually on caret hiding)
     * @constructor
     * @param {function} callback - Callback function
     */
    sel.onBlur=function(callback) {
        _registerCallback('blur',callback);
    };

    /**
     * Adds callback on focus in
     * @constructor
     * @param {function} callback - Callback function
     */
    sel.onFocusIn=function(callback) {
        _registerCallback('focusin',callback);
    };

    /**
     * Adds callback on focus out
     * @constructor
     * @param {function} callback - Callback function
     */
    sel.onFocusOut=function(callback) {
        _registerCallback('focusout',callback);
    };

    /**
     * Adds callback on focus other element (not body)
     * @constructor
     * @param {function} callback - Callback function
     */
    sel.onFocusOther=function(callback) {
        _registerCallback('focusother',callback);
    };

    /**
     * Shows keyboard (iOS,Android)
     * @constructor
     */
    sel.showKeyboard=function(el, offset) {
        if(_debug) console.log('sel.showKeyboard');
        if(_isEditable) _parentElement.setAttribute('contentEditable',true);
        _parentElement.focus();

        if(sel.startElement==null) {
            sel.setCaret(el ? el : _parentElement.firstChild, offset ? offset : 0);
        }

        if(sel.isEmpty) { _restoreCaret();}
        else {
            var winSel = window.getSelection();
            winSel.removeAllRanges();
            var range=_range.cloneRange();
            range.collapse(false);
            winSel.addRange(range);
        }
        _scrollRngDelayed(_range);

        sel.scrollFromBehindToolbar(1000);
    }

    /**
     * Scrools to visible area if cursor appears behind toolbar while editarea is being focused/blured
     * @constructor
     */
    sel.scrollFromBehindToolbar=function(timeout) {
        return;
        if(_debug) console.log('sel.scrollFromBehindToolbar')
        var wRange;
        var wSel = window.getSelection();
        wRange = _range || wSel.getRangeAt(0);

        if(wRange != null) {

            setTimeout(function () {
                var rangeRect = wRange.getClientRects()[0];
                var barRect = _topElementForScrollCheck.getBoundingClientRect();
                var topY = barRect.bottom - (_parentElement.style.marginTop ? _parentElement.style.marginTop.replace('px', '') : 0);
                .3
                var scrollTop = window.pageYOffset || document.documentElement.scrollTop;

                if(rangeRect && rangeRect.top < barRect.bottom && rangeRect.top && rangeRect.top > topY) {
                    _scrollWindow(0, scrollTop - (barRect.bottom-rangeRect.top)-5);
                } else if (_parentElement.textContent.trim() == '') {
                    _scrollWindow(0, scrollTop - _parentElement.offsetTop-barRect.height);

                }
            }, timeout != null ? timeout : 500);
        } else if(_parentElement.innerHTML.trim() == '') {
            var barRect = _topElementForScrollCheck.getBoundingClientRect();
            _scrollWindow(0, _parentElement.offsetTop-barRect.height);

        }
    }

    /**
     * Sets caret to given position
     * @constructor
     * @param {DOMElement} el - DOM element
     * @param {int} offset - offset position at the element
     */
    sel.setCaret=function(el,offset) {
    if(_debug) console.log('setCaret START', el, offset)
        _cancelCaretDelayed();
        sel.isEmpty=true;
        var range = document.createRange();
        var winSel = window.getSelection();
        range.setStart(el, offset);
        range.setEnd(el, offset);
        //range.collapse(true);
        winSel.removeAllRanges();
        winSel.addRange(range);

        _range.setStart(el,offset);
        _range.collapse(true);
        sel.startElement=_range.startContainer;
        sel.startIndex=_range.startOffset;
        sel.endElement=null;
        sel.endIndex=-1;

        _runCallback('focus');
    }
      
    /**
     * Selects given DOMElement
     * @constructor
     * @param {DOMElement} el - DOM element
     */
    sel.selectNode=function(el) {
        _cancelCaretDelayed();

        _clearSelectionTags(true);

        try {
            var node=el;
            while(node.nodeType!=3 && node.childNodes.length) {
                node=node.childNodes[0];
            }
            if(node.tagName=='IMG') {
                _range.setStart(el,0);
                var nextSibling = el.nextSibling;
                if(nextSibling.nodeType!=3) {

                    while(nextSibling.nodeType!=3 && nextSibling.childNodes.length) {
                        nextSibling=nextSibling.childNodes[0];
                    }
                }
                _range.setEnd(nextSibling,0);
            } else {
                _range.selectNode(node);
                _range.setStart(node,0);
                _range.setEnd(node,node.nodeValue.length);
            }
        } catch(err) {
            console.log('Error:',err);
        }

        _applySelection();
        if(sel.options.drawSelectionCarets) _drawEnds(_range);
    }
    /**
     * Selects child elements DOMElement
     * @constructor
     * @param {DOMElement} el - DOM element
     */
    sel.selectNodeContents=function(el) {
        _range.selectNodeContents(el)
        _applySelection();
        if(sel.options.drawSelectionCarets) _drawEnds(_range);
    }
    /**
     * Resets caret to previous known position
     * @constructor
     */
    sel.resetCaret=function() {
        _restoreCaret();
    }

    /**
     * Resets selection based on current _range (is needed for restoring caret position after commands' execution)
     * @constructor
     */
    sel.restoreEditareaState=function() {
        //_restoreEditareaState();
    }

    /**
     * Clears selection
     * @constructor
     */
    sel.clearSelection=function() {
        _clearSelection()
    }


    /**
     * Resets _range based on selection span already applied before
     * @constructor
     */
    sel.restoreRangeBasedOnSelClass=function() {
        _restoreRangeBasedOnSelClass();
    }

    /**
     * Draws selection endpoints. As external function is used while image is being resized
     * @constructor
     */
    sel.drawEnds=function() {
        _drawEnds(_range);
    }

    /**
     * Removes selection
     * @constructor
     */
    sel.deselect=function() {
        _clearSelection();
    }

    /**
     * Removes selection
     * @constructor
     */
    sel.getRangeFromPoint=function(e, x, y) {
        return _getRangeFromPoint(e, x, y);
    }

    /**
     * Disables HTMLSelector
     * @constructor
     */
    sel.disable=function(isDisabled) {
        _disabled=isDisabled?true:false;
    }

    /**
     * Scrolls textarea to where it was before mode was changed to HTML
     * @constructor
     */
    sel.restoreScrollTop=function(isDisabled) {
        return;
        var curerntRawNode
        if(_range.startContainer.nodeType == 3)
            curerntRawNode = _range.startContainer.textContent;
        else if(_range.startContainer.nodeType == 1)
            curerntRawNode = _range.startContainer.innerHTML;

        if(curerntRawNode)
            return {startContainerValue:curerntRawNode, startOffset:_range.startOffset, endOffset:_range.endOffset};
        else return false;
    }

    /**
     * Sets caret to given position with a delay (if its enabled in options)
     * @constructor
     * @param {DOMElement} el - DOM element
     * @param {int} offset - offset position at the element
     */
    sel.setCaretDelayed=function(el,offset) {
        if(_debug) console.log('setCaretDelayed START')
        if(!sel.options.keyboardDelay) return sel.setCaret(el,offset);
        _cancelCaretDelayed();
        if(_debug) console.log('setCaretDelayed 2')

        var range = document.createRange();
        range.setStart(el, offset);
        range.collapse(true);

        var rects=range.getClientRects();

        if(!rects.length) return;
        var rect=rects[0];

        if(!_customCaretEl) {
            _customCaretEl=document.createElement('DIV');
            _customCaretEl.className=sel.options.customCaretClassName;
            _customCaretEl.style.position='absolute';
            _customCaretEl.style.width='1px';
        }

        _customCaretEl.style.height=rect.height+'px';

        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

        _customCaretEl.style.top=scrollTop+rect.top+'px';
        _customCaretEl.style.left=scrollLeft+rect.left+'px';
        document.body.appendChild(_customCaretEl);

        _customCaretTS = setTimeout(function () {
            sel.setCaret(el, offset);
            document.body.removeChild(_customCaretEl);
        }, 300);

        //_range.setStart(el,offset);
        //_range.collapse(true);
    }

    /**
     * Selects word in given caret index
     * @constructor
     * @param {DOMElement} el - DOM element
     * @param {int} offset - offset position at the element
     */
    sel.selectWord=function(e) {
        //if(_isEditable) _parentElement.setAttribute('contentEditable',false);

        _clearSelection(true);

        if (_debug) console.log('sel.selectWord START', e, e.touches);

        var touch;
        if (e.changedTouches.length == 1 || e.touches.length == 1) {
            touch = e.changedTouches[0] || e.touches[0];
        } else return;
        if (_debug) console.log('sel.selectWord touch', touch);

        var range, node, offset;
        var x = touch.clientX, y = touch.clientY;

        range = _getRangeFromPoint(e, x, y);
        if (range == null) return;
        node = range.offsetNode || range.startContainer;
        offset = range.offset || range.startOffset;
        if (_debug) console.log('sel.selectWord node', node, offset);

        range.collapse(true);

        var nodeValue = range.startContainer.textContent;

        var wordStartIndex, startOffset;
        for (startOffset = offset; startOffset >= 0; startOffset--) {
            var char = nodeValue.charAt(startOffset);
            if (/[\W\s\n]/i.test(char) == true) {
                wordStartIndex = startOffset;
                break;
            }
        }
        if (_debug) console.log('sel.selectWord wordStartIndex', wordStartIndex);
        if (wordStartIndex == null) wordStartIndex = 0;
        let charAtStartIndex = nodeValue.charAt(wordStartIndex);
        if (_debug) console.log('sel.selectWord wordStartIndex222', nodeValue.charAt(wordStartIndex));

        var wordEndIndex = nodeValue.slice(offset).search(/[\W\s\n]/i);

        if (_debug) console.log('sel.selectWord wordEndIndex', wordEndIndex);
        let startOfset = wordStartIndex;
        const regex = new RegExp(' ');
        if(regex.test(charAtStartIndex)) {
            startOfset = wordStartIndex + 1;
        }
        range.setStart(node, startOfset);
        range.setEnd(node, wordEndIndex != -1 ? offset + wordEndIndex : nodeValue.length);

        _range.setStart(range.startContainer, range.startOffset);
        _range.setEnd(range.endContainer, range.endOffset);


        _applySelection();
        if (sel.options.drawSelectionCarets) _drawEnds(_range);

        //we need this block of code to keep keyboard active (on Android) as it disapperas without this code
        if(_isAndroid){
            var winSel = window.getSelection();
            winSel.removeAllRanges();
            var range=_range.cloneRange();
            range.collapse(false);
            winSel.addRange(range);
        }

       /*  var startXYcoords = _range.getClientRects()[0];
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        _startX = startXYcoords.left;
        _startY = scrollTop + startXYcoords.top;

        _startYtop = scrollTop + startXYcoords.top;
        _startYbottom = scrollTop + startXYcoords.bottom; */
        _runCallback('selectionEnd');


    }
    window.selectWordPrev = function () {
        if(_latestTouch.e) sel.selectWord(_latestTouch.e);
    };
    /**
     * Selects word in given caret index
     * @constructor
     * @param {DOMElement} el - DOM element
     * @param {int} offset - offset position at the element
     */
    sel.selectWord2=function(el,offset) {
        //if(_isEditable) _parentElement.setAttribute('contentEditable',false);

        _clearSelection(true);


        var range = document.createRange();
        if(el.nodeType!==3) {
            return false;
        } else {
            range.setStart(el, offset);
            range.collapse(true);
            range.expand('word');

            _range.setStart(range.startContainer,range.startOffset);
            _range.setEnd(range.endContainer,range.endOffset);
        }
        _applySelection();
        if(sel.options.drawSelectionCarets) _drawEnds(_range);

        //if(_isEditable) _parentElement.setAttribute('contentEditable',true);

        /* var winSel = window.getSelection();
        winSel.removeAllRanges();
        var range=_range.cloneRange();
        range.collapse(false);
        sel.focusIsBeingCalled();
        winSel.addRange(range); */

        _runCallback('selectionEnd');

    }



    /**
     * Selects paragraph in given caret index
     * @constructor
     * @param {DOMElement} el - DOM element
     * @param {int} offset - offset position at the element
     */
    sel.selectParagraph=function(e) {
        //if(_isEditable) _parentElement.setAttribute('contentEditable',false);

        _clearSelection(true);

        if (_debug) console.log('sel.selectParagraph START', e, e.touches);

        var touch;
        if (e.changedTouches.length == 1 || e.touches.length == 1) {
            touch = e.changedTouches[0] || e.touches[0];
        } else return;
        if (_debug) console.log('sel.selectParagraph touch', touch);

        var rangeFromPoint, node, offset;
        var x = touch.clientX, y = touch.clientY;

        rangeFromPoint = _getRangeFromPoint(e, x, y);
        if (rangeFromPoint == null) return;
        node = rangeFromPoint.offsetNode || rangeFromPoint.startContainer;
        offset = rangeFromPoint.offset || rangeFromPoint.startOffset;
        if (_debug) console.log('sel.selectParagraph node', node, offset);

        rangeFromPoint.collapse(true);

        let parentParagraph = findBlockParent(node);
        if (_debug) console.log('sel.selectParagraph parentParagraph', parentParagraph);

        if(!parentParagraph) {
            return;
        }

        _range.selectNodeContents(parentParagraph);
        if (_debug) console.log('sel.selectParagraph _range', _range.startContainer, _range.endContainer);

        _applySelection();
        if (sel.options.drawSelectionCarets) _drawEnds(_range);

        var winSel = window.getSelection();
        winSel.removeAllRanges();
        var range=_range.cloneRange();
        range.collapse(false);
        winSel.addRange(range);

        _runCallback('selectionEnd');

    }

    /**
     * Selects paragraph in given caret index
     * @constructor
     * @param {DOMElement} el - DOM element
     * @param {int} offset - offset position at the element
     */
    sel.selectParagraph2=function(el,offset) {
        if(_debug) console.log('sel.selectParagraph START', el, offset);
        //if(_isEditable) _parentElement.setAttribute('contentEditable',false);

        _clearSelection(true);


        var range = document.createRange();
        range.setStart(el, offset);
        range.collapse(true);
        var winSel = window.getSelection();
        winSel.removeAllRanges();
        try {
            if(_debug) console.log('sel.selectParagraph TRY');
            winSel.addRange(range);
            winSel.modify('move','left','paragraph');
            if(_debug) console.log('sel.selectParagraph TRY 2', winSel.getRangeAt(0));
            winSel.modify('extend','right','paragraph');
            range=winSel.getRangeAt(0);
            _range.setStart(range.startContainer,range.startOffset);
            _range.setEnd(range.endContainer,range.endOffset);
            winSel.removeAllRanges();
        } catch(err) {

            if(_debug) console.log('sel.selectParagraph ERROR');
        }
        if(_debug) console.log('sel.selectParagraph _range', _range.startContainer, _range.endContainer);

        _applySelection();
        if(sel.options.drawSelectionCarets) _drawEnds(_range);

        //if(_isEditable) _parentElement.setAttribute('contentEditable',true);


        /* var winSel = window.getSelection();
        winSel.removeAllRanges();
        var range=_range.cloneRange();
        range.collapse(false);
        winSel.addRange(range); */

        _runCallback('selectionEnd');

    }

    /**
     * Selects text wihin braces {}, (), [],
     * @constructor
     * @param {DOMElement} el - DOM element
     * @param {int} offset - offset position at the element
     */
    sel.selectBracesFrag=function(e) {
        //if(_isEditable) _parentElement.setAttribute('contentEditable',false);
        if (_debug) console.log('sel.selectBracesFrag START', e, e.touches);

        _clearSelection(true);


        var touch;
        if (e.changedTouches.length == 1 || e.touches.length == 1) {
            touch = e.changedTouches[0] || e.touches[0];
        } else return;
        if (_debug) console.log('sel.selectBracesFrag touch', touch);

        var rangeFromPoint, node, offset;
        var x = touch.clientX, y = touch.clientY;

        rangeFromPoint = _getRangeFromPoint(e, x, y);
        if (rangeFromPoint == null) return;
        node = rangeFromPoint.offsetNode || rangeFromPoint.startContainer;
        offset = rangeFromPoint.offset || rangeFromPoint.startOffset;
        if (_debug) console.log('sel.selectBracesFrag offset', offset);

        var nodeValue = rangeFromPoint.startContainer.textContent;

        var brace, fragStartIndex, fragEndIndex;
        fragEndIndex = nodeValue.slice(offset, nodeValue.length).search(/[\},\],\)]/i);
        if(fragEndIndex == -1) return sel.selectParagraph(e);

        fragEndIndex = offset + fragEndIndex;

        var foundBrace = nodeValue.charAt(fragEndIndex);
        brace = foundBrace == "}" ? "{" : (foundBrace == ")" ? "(" : "[")
        if (_debug) console.log('sel.selectBracesFrag foundBrace', foundBrace);
        if (_debug) console.log('sel.selectBracesFrag nodeValue', nodeValue);
        //nodeValue = rangeFromPoint.startContainer.textContent;
        if (_debug) console.log('sel.selectBracesFrag offset', offset);

        var fragStartIndex, startOffset;
        for(startOffset=offset; startOffset>=0; startOffset--){
            var char = nodeValue.charAt(startOffset);
            if (_debug) console.log('sel.selectBracesFrag char', char);

            if(char == brace) {
                if (_debug) console.log('sel.selectBracesFrag break', char);

                fragStartIndex = startOffset;
                break;
            }
            if(/[\W[\s]]/i.test(char) == true) {
                if (_debug) console.log('sel.selectBracesFrag test', true);

                fragStartIndex == null; 
                break;
            }
        }
        if (_debug) console.log('sel.selectBracesFrag fragStartIndex', fragStartIndex);

        if(fragStartIndex == null) return sel.selectParagraph(e);


        fragStartIndex++;

        _range.setStart(node,fragStartIndex);
        _range.setEnd(node,fragEndIndex);


        _applySelection();
        if(sel.options.drawSelectionCarets) _drawEnds(_range);

        //if(_isEditable) _parentElement.setAttribute('contentEditable',true);


        var winSel = window.getSelection();
        winSel.removeAllRanges();
        var range=_range.cloneRange();
        range.collapse(false);
        winSel.addRange(range);

        _runCallback('selectionEnd');

    }

    /**
     * Adds DOM element to exclude list, so the selection would NOT be cleared,
     * when this element (or any of its children) takes focus from us
     * Example: toolbar
     * @param {DOMElement} el - DOM element
     */
    sel.addFocusElement=function(el) {
        _focusOutExclude.push(el);
    }

    /**
     * UPD:method should be removed; Adds DOM element to exclude list, so if it was tapped, the editarea will not loose its focus
     * (focus will be set back)
     * Example: toolbar
     * @param {DOMElement} el - DOM element
     */
    sel.addPreventingBlurElement=function(el) {
        _preventingEditareaBlurElems.push(el);
    }

    /**
     * Hook that is triggered on toolbar focus. For now, it is used to determine whether editarea has focus before it moved to toolbar
     */
    sel.toolbarWasTapped = function () {
        if(_debug) console.log('sel.toolbarWasTapped');
        sel.latestScrollTop = window.pageYOffset || document.documentElement.scrollTop;

        if((_latestTouch.e.target != _parentElement && !_parentElement.contains(_latestTouch.e.target))
            && _previousTouch && (_previousTouch.e.target != _parentElement && !_parentElement.contains(_previousTouch.e.target))){
            return;
        }
        if(_debug) console.log('sel.toolbarWasTapped _previousTouch', _previousTouch);

        if(_previousTouch && (_previousTouch.e.target == _parentElement || (_parentElement.contains(_previousTouch.e.target) && _previousTouch.isEditareaActive))){
            if(_debug) console.log('sel.toolbarWasTapped 1');

            _wasParentElementActive = true;
        } else if(_previousTouch == null && _latestTouch.e.target == _parentElement || _parentElement.contains(_latestTouch.e.target)){
            if(_debug) console.log('sel.toolbarWasTapped 2');
            _wasParentElementActive = true;
        }

        if((!_isiOS || (typeof Q != 'undefined' && Q.Cordova != null)) && window.innerHeight < _windowHeight.initial){
            if(_debug) console.log('sel.toolbarWasTapped 3');
            _wasParentElementActive = true;
        }

    }

    /**
     * Hook that is triggered on toolbar's submenu is opened. It is used to hide caret and range endpoints.
     */
    sel.toolbarGroupOpened = function () {
        if(_debug) console.log('sel.toolbarGroupOpened');
        //_restoreRangeBasedOnSelClass();
        var rangeToRestore = _range.cloneRange();

        if(_leftCaret) {
            var range = document.createRange();
            range.setStart(rangeToRestore.startContainer, rangeToRestore.startOffset);
            range.setEnd(rangeToRestore.endContainer, rangeToRestore.endOffset);

            if(_leftCaret.parentNode) _leftCaret.parentNode.removeChild(_leftCaret);
            if(_rightCaret.parentNode) _rightCaret.parentNode.removeChild(_rightCaret);
        }
    }

    /**
     * Hook that is triggered on toolbar's submenu is opened. It is used to hide caret and range endpoints.
     */
    sel.toolbarGroupClosed = function () {
        if(_debug) console.log('sel.toolbarGroupClosed');

        if(!sel.isEmpty && sel.options.drawSelectionCarets) _drawEnds(_range);
    }

    sel.setLatestTouch = function(e) {
        _hadlerOnDocumentTouchStart(e)
    }

    sel.isKeyboardIsActive = function() {
        return document.activeElement == _parentElement;
    }

    sel.keyboardIsActive = function(state) {
        return;
        if (document.activeElement != _parentElement) return;
        if(state === false) {
            if(document.querySelector('.editarea:focus') != null) {
                sel.isCallingBlur = true;
                _parentElement.blur();
                _parentElement.setAttribute('contenteditable', false);
                _isDocumentActiveElement = false;
                setTimeout(function () {
                    sel.isCallingBlur = null;
                }, 50);
            }
        } else if(state === true && !sel.isCallingFocus)
            _focusParent();
    }

    sel.setInitialWindowheight = function(height) {
        _windowHeight.initial = height;
    }

    /**
     * Checks whether editarea contenteditable
     */
    sel.isEditareaEditable= function () {
        return _parentElement.getAttribute('contenteditable') ? true : false;
    }
    /**
     * Set isCallingFocus=true to prevent multiple focusing. Should be called each time focus handler is executed.
     */
    sel.focusIsBeingCalled = function () {
        sel.isCallingFocus=true;
        setTimeout(function() {sel.isCallingFocus=null; if(_debug){console.log('sel.focusIsBeingCalled : sel.isCallingFocus=null');}},50);
    }
    /**
     * Set isCallingFocus=true to prevent multiple focusing. Should be called each time focus handler is executed.
     */
    sel.imgIsBeingResized = function (state) {
        _isResizing=state;
    }

    /**
     * Searches string in the document
     */
    sel.findInText = function(string, searchBox, counterEl){
        this.query = string;
        this.prevQuery;
        this.allResults = [];
        this.resultsQuantity = 0;
        this.currentMatch = -1;
        this.prevMatch = null;
        this.counterEl = counterEl; //to display
        this.searchBox = searchBox; //to make box transparent when it overlays some of highlights



        this.doFind = function() {
            this.allResults = [];
            var allDocRange = document.createRange();
            allDocRange.setStartBefore(_parentElement.firstChild);
            allDocRange.setEndAfter(_parentElement.lastChild);
            this.nodes=_getRangeNodes(allDocRange.cloneRange());

            var i,node;

            for(i=0;i<this.nodes.length;i++) {

                node=this.nodes[i];
                if(node.nodeType===3) {
                    if(node.length==0) {
                        node.parentNode.removeChild(node);
                        continue;
                    }

                    if(node.data.match(/^[\s\n\r]+$/)) {
                        //node.parentNode.removeChild(node);
                        node.parentNode.removeChild(node);
                        continue;
                    }
                }

                if(node.nodeType!==3) continue;

                var pattern = new RegExp("" + this.query + "", 'gi');

                var currentNodeMatches = [];
                var result;
                while (result = pattern.exec(node.nodeValue)) {
                    currentNodeMatches.push({
                        matchResult:result,
                        startIndex:result.index,
                        endIndex:pattern.lastIndex,
                        node: node
                    });
                }

                //this.allResults.push(currentNodeMatches);

                if(currentNodeMatches.length == 0) continue;

                var curNode = node;
                var lastIndex = 0;
                var match, i;
                for(i = 0; match = currentNodeMatches[i]; i++){
                    if(curNode == null) continue;
                    var matchRange = document.createRange();
                    matchRange.setStart(curNode, match.startIndex - lastIndex)
                    matchRange.setEnd(curNode, match.endIndex - lastIndex)

                    var highlightNode = document.createElement('SPAN');
                    highlightNode.className = 'Q_HTMLselector_finding-result ' + sel.options.className;
                    highlightNode.tabIndex = '0';
                    matchRange.surroundContents(highlightNode);

                    curNode = highlightNode.nextSibling;
                    lastIndex = match.endIndex;

                    this.allResults.push(highlightNode);
                }

            }

            this.resultsQuantity = this.allResults.length;

            this.prevQuery = this.query;
        }

        this.next = function() {

            if(this.resultsQuantity != 0) {

                if(this.currentMatch == this.resultsQuantity-1)
                    this.currentMatch = 0;
                else
                    this.currentMatch++;

                this.step();


                this.updateCounter()

                return this;
            }
        }

        this.prev = function() {

            if(this.resultsQuantity != 0) {
                if(this.currentMatch == 0)
                    this.currentMatch = this.resultsQuantity-1;
                else
                    --this.currentMatch;

                this.step();

                this.updateCounter()

                return this;

            }
        }

        this.step = function () {
            var highlightedMartchEl = this.allResults[this.currentMatch];

            var matchRect = highlightedMartchEl.getBoundingClientRect()

            var barRect = _topElementForScrollCheck.getBoundingClientRect();
            var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            var scrollTo = scrollTop + matchRect.top - barRect.bottom - 120;

            _scrollWindow(0, scrollTo);

            var searchBoxRect = this.searchBox.getBoundingClientRect();
            var matchTop = scrollTop + matchRect.top;
            var matchBottom = scrollTop + matchRect.bottom;
            if(matchTop >= searchBoxRect.top && matchBottom <= searchBoxRect.bottom
                && matchRect.left >= searchBoxRect.left && matchRect.right <= searchBoxRect.right)
                this.searchBox.style.opacity = '0.7';
            else
                this.searchBox.style.opacity = '';

            if(this.prevMatch != null) this.prevMatch.classList.remove('active-match');
            highlightedMartchEl.classList.add('active-match');
            this.prevMatch = highlightedMartchEl;

        }

        this.replace = function (replaceText) {
            if(this.currentMatch == -1) {

                this.doFind();
                this.next();
                return;
            }

            var match = this.allResults[this.currentMatch];

            var nodeThatReplaces = document.createTextNode(replaceText)
            match.parentNode.replaceChild(nodeThatReplaces, match);

            _removeEmptyNodes(_parentElement);
            _parentElement.normalize();
            this.allResults.splice(this.currentMatch, 1);
            --this.resultsQuantity
        }

        this.replaceCurrentMatch = function (replaceText) {
            this.replace(replaceText)
            this.step();
            this.updateCounter();
            return this;
        }

        this.replaceAllPlaceholders = function (replaceText) {
            this.currentMatch = this.resultsQuantity-1;
            while(this.currentMatch >= 0){
                this.replace(replaceText);
                this.currentMatch = this.resultsQuantity-1;
            }
            this.updateCounter();
            return this;
        }

        this.updateCounter = function () {
            this.counterEl.innerHTML = this.currentMatch+1 + ' of ' + this.resultsQuantity
        }

        if(this.query.trim() != '') {
            _clearSelection();
            this.doFind();
            this.next();
            this.updateCounter()
        } else {
            _clearSelection();
            this.resultsQuantity = 0;
            this.currentMatch = -1;
            this.updateCounter();
            return this;
        }
    }

    /**
     * Checks if user is scrolling
     */
    sel.isScrolling=function() {
        return _isScrolling;
    }

    /**
     * Set element, which bottom boundary will be used as initial point by _checkScrolling function
     */
    sel.setTopElementForScrollCheck=function(el) {
        _topElementForScrollCheck = el
    }

    /**
     * Checks if user is selecting
     */
    sel.isSelecting=function() {
        return _isSelecting;
    }

    /**
     * Checks if user is dragging text or images
     */
    sel.isDragging=function() {
        return _startDragging;
    }

    /**
     * Checks if the selection is wrapped with tag OR contains any elements wrapped into the given tag
     * @param {string} tagName - tag name
     * @param {string} [param] - attribute of tag name that should be present
     * @param {string} [value] - value of the attribute that should be set
     */
    sel.contains=function(tagName,param,value) {
        if(!sel.isEmpty) {
            var _nodes=_getRangeNodes(_range,false);
            if(!_nodes) return false;
            var i,node;

            var k=0;
            var val=true,newVal;

            var isWrapped=true;
            var contains=false;
            for(i=0;i<_nodes.length;i++) {
                node=_nodes[i];
                if(node.tagName==tagName) {
                    newVal=_isInsideTag(node,tagName,param,value);
                } else {
                    if(node.nodeType!==3) {
                        continue;
                    }
                    if(node==_range.startContainer && node.length==_range.startOffset) continue;
                    if(node==_range.endContainer && _range.endOffset==0) continue;
                }
                k++;
                newVal=_isInsideTag(node,tagName,param,value);
                if(!newVal) {
                    isWrapped=false;
                    continue;
                } else {
                    contains=true;
                    if(newVal!==val && val===true) val=newVal;
                }
            }
            if(k==0) return false;
            if(!contains) return false;

            if(typeof val!='object') val={contains:contains}; else val.contains=contains;
            val.wrapped=isWrapped;
            return val;
        } else if(sel.startElement!=null) {
            var val=_isInsideTag(sel.startElement,tagName,param,value);
            if(!val) return false;
            if(typeof val!='object') val={contains:true,wrapped:true}; else {val.contains=true;val.wrapped=true};
            return val;
        }
    }


    /**
     * Looks for <a href> in the selection and returns link text and url of the first instance
     */
    /*sel.findHref=function() {
        var tagName='A';

        if(!sel.isEmpty) {
            var _nodes=_getRangeNodes(_range);
            if(!_nodes) return false;
            var i,node;

            var k=0;
            var val=true,newVal;

            var isWrapped=true;
            var contains=false;
            for(i=0;i<_nodes.length;i++) {
                node=_nodes[i];
                if(node.nodeType!==3) {
                    continue;
                }
                if(node==_range.startContainer && node.length==_range.startOffset) continue;
                if(node==_range.endContainer && _range.endOffset==0) continue;
                k++;
                newVal=_isInsideTag(node,tagName,param,value);

                if(!newVal) {
                    isWrapped=false;
                    continue;
                } else {
                    contains=true;
                    if(newVal!==val && val===true) val=newVal;
                }
            }
            if(k==0) return false;
            if(!contains) return false;

            if(typeof val!='object') val={contains:contains}; else val.contains=contains;
            val.wrapped=isWrapped;
            return val;
        } else if(sel.startElement!=null) {
            var val=_isInsideTag(sel.startElement,tagName,param,value);
            if(!val) return false;
            if(typeof val!='object') val={contains:true,wrapped:true}; else {val.contains=true;val.wrapped=true};
            return val;
        }
    }*/

    /**
     * Wraps selection with given tag
     * @param {string} tagName - tag name
     */
    sel.wrapSelection=function(tagName) {
        if(_debug) console.log('sel.wrapSelection', tagName);
        sel.stateSave();

        if(!_isDocumentActiveElement && sel.isEmpty) return;

        if(!sel.isEmpty) {
            if(!_range||!_range.startContainer||!_range.endContainer) return false;
            //clean inner similar tags
            sel.unwrapSelection(tagName);

            _wrapSelection(_range,tagName);

            sel.isEmpty=_range.startContainer==_range.endContainer && _range.startOffset==_range.endOffset;

            sel.startElement=_range.startContainer;
            sel.startIndex=_range.startOffset;
            sel.endElement=_range.endContainer;
            sel.endIndex=_range.endOffset;
            sel.range=_range;


            if(sel.options.drawSelectionCarets) _drawEnds(_range);

            sel.focusIsBeingCalled();
            //if(_wasParentElementActive) sel.setCaret(_range.endContainer, _range.endOffset); //commented 28.03.24. as not more needed on iOS
            _restoreEditareaState();
        } else {
            var winSel=window.getSelection();
            if(!winSel||!winSel.rangeCount) {
                return _restoreEditareaState();
            }
            var rng=winSel.getRangeAt(0);
            if(!rng) {
                return _restoreEditareaState();
            }

            var el=document.createElement(tagName);

            var range=document.createRange();
            range.setStart(rng.startContainer,rng.startOffset);
            range.collapse(true);

            range.surroundContents(el);

            //This hack is inserting zero-width character to allow caret go inside the element
            //Otherwise the browser would always put caret BEFORE empty element
            el.innerHTML='&#8203;';
            sel.focusIsBeingCalled();

            if(_isiOS) {
                sel.setCaret(el.previousSibling,0);
            } else sel.setCaret(el,1);

            _restoreEditareaState();

            // fix for iOS: timeout needed for iOS as cursor aren't blinking after node created setCaret(el,0)
            if(_isiOS) {
                setTimeout(function () {
                    sel.focusIsBeingCalled();
                    sel.setCaret(el, 1);
                    _restoreEditareaState();
                }, 100);
            }
            return el;
        }
        _restoreRangeBasedOnSelClass();

        /*   if(!sel.isEmpty) {
               //sel.setCaret(_range.endContainer, _range.endOffset)
               _restoreRangeBasedOnSelClass();
               if(sel.options.drawSelectionCarets) _drawEnds(_range);
           }*/
    }

    /**
     * Unwraps selection from given tag
     * @param {string} tagName - tag name
     */
    sel.unwrapSelection=function(tagName,param) {
       if(_debug) console.log('unwrapSelection: START')
        sel.stateSave();
        if(!sel.isEmpty) {
           if(_debug) console.log('unwrapSelection: 1')
            if(!_range||!_range.startContainer||!_range.endContainer) return false;

            var _nodes=_getRangeNodes(_range);
            if(!_nodes) return false;
           if(_debug) console.log('unwrapSelection: _nodes', _nodes)
            var i,node,par;//,outboundChanged=false;
            for(i=0;i<_nodes.length;i++) {
                node=_nodes[i];
               if(_debug) console.log('unwrapSelection: FOR START', node, node.parentNode)
                do {
                   if(_debug) console.log('unwrapSelection: DO while START', node.nodeName, node.textContent)
                    if(node.tagName==tagName && (!param || node.getAttribute(param))) {
                        if(node.nodeType!=3 && node.innerHTML.length==0) { //remove empty element
                            node.parentNode.removeChild(node);
                        } else {
                            var parent = node.parentNode;
                            while (node.firstChild) { //move all child nodes outside of element
                                parent.insertBefore(node.firstChild, node);
                            }
                            parent.removeChild(node);//remove element
                        }
                    }

                    node=node.parentNode;
                } while(node && node!=document && node!=_parentElement);
            }
            _restoreRangeBasedOnSelClass();

            _removeEmptyNodes(_parentElement);
            _parentElement.normalize();

            sel.isEmpty=_range.startContainer==_range.endContainer && _range.startOffset==_range.endOffset;

            sel.startElement=_range.startContainer;
            sel.startIndex=_range.startOffset;
            sel.endElement=_range.endContainer;
            sel.endIndex=_range.endOffset;
            sel.range=_range;


            if(sel.options.drawSelectionCarets) _drawEnds(_range);
        } else if(sel.startElement!=null) {
            //TODO
            //replace with winSel
            var elementToUnwrap = sel.startElement;
            if(elementToUnwrap.nodeType != 1) elementToUnwrap = _isInsideTag(elementToUnwrap, tagName);
            if(elementToUnwrap.tagName==tagName && (!param || elementToUnwrap.getAttribute(param))) {

                //cases: if cursor is within styled text; if cursor is after/before text
                if(elementToUnwrap.innerHTML.match(/^[\u200B\s\r\n]{0,2}$/) || elementToUnwrap.innerHTML.length==0) { //may be also add some whitespace content for this check
                    //remove element
                    var next=elementToUnwrap.nextSibling;
                    sel.setCaret(next,0);
                    elementToUnwrap.parentNode.removeChild(elementToUnwrap);

                } else {
                    //remove zero width symbol
                    elementToUnwrap.innerHTML=elementToUnwrap.innerHTML.replace(/\u200B/,'');
                    //otherwise just move caret to the next sibling
                    var next=elementToUnwrap.nextSibling;
                    if(next != null) {
                        if (next.nodeType == 3) next.nodeValue = '\u200B' + next.nodeValue;
                        sel.focusIsBeingCalled();
                        sel.setCaret(next,1);
                    } else {
                        var zeroWidth = document.createTextNode("\u200B\u200B");
                        elementToUnwrap.parentNode.appendChild(zeroWidth);

                        if(_isiOS) {
                            sel.setCaret(zeroWidth, 1);
                        }else {
                            var winSel = window.getSelection()
                            if(winSel.rangeCount > 1) {
                                for (var i = 1; i < winSel.rangeCount; i++) {
                                    winSel.removeRange(winSel.getRangeAt(i));
                                }
                            }

                            if(winSel.rangeCount == 1) {
                                var rangeToModify = winSel.getRangeAt(0);
                                rangeToModify.setStartAfter(zeroWidth);
                                winSel.collapseToEnd();
                            } else {
                                var range = document.createRange();
                                range.setStart(zeroWidth, 1)
                                range.collapse(true)
                                sel.focusIsBeingCalled();
                                winSel.addRange(range);
                            }
                        }
                    }
                    //sel.setCaret(next,1);
                }
            }
            //_restoreEditareaState();
            return;
        } else {
            _restoreEditareaState();
            return;
        }

    }

    window.unwrap = sel.unwrapSelection;
    /**
     * Checks if the selection is wrapped with the given tag
     * @param {string} tagName - tag name
     * @param {string} [param] - attribute of tag name that should be present
     * @param {string} [value] - value of the attribute that should be set
     */
    sel.checkWrapped=function(tagName,param,value) {
        if(param=='style' && typeof value != 'object') {
            if(value && value.indexOf('#')===0) {
                value='background-color: '+_hexToRgb(value)+';';
            }
        }

        if(tagName=='FONT') {
            if(param=='size') {
                if(value==3) {

                    if(sel.checkWrapped(tagName,param)) {
                        return false;
                    }
                    if(sel.checkWrapped(tagName,'style')) {
                        return false;
                    }
                    return true;
                }
            }
        }
        if(!sel.isEmpty) {
            var _nodes=_getRangeNodes(_range);
            if(!_nodes) return false;
            var i,node;
            var k=0;
            var val=true,newVal;
            for(i=0;i<_nodes.length;i++) {
                node=_nodes[i];
                if(node.nodeType!==3) {
                    continue;
                }
                if(node==_range.startContainer && node.length==_range.startOffset) continue;
                if(node==_range.endContainer && _range.endOffset==0) continue;
                k++;
                newVal=_isInsideTag(node,tagName,param,value);
                if(!newVal) {
                    return false;
                } else {
                    if(newVal!==val && val===true) val=newVal;
                }
            }
            if(k==0) {
                return false;
            }
            return val;
        } else if(sel.startElement!=null) {
            var newVal = _isInsideTag(sel.startElement,tagName,param,value);
            return newVal;
        }
    }

    sel.removeCSSInRange=function (range, property) {
       if(_debug) console.log('removeCSSInRange: START', range.startContainer, range.endContainer)
        if (!range || !range.startContainer || !range.endContainer) return false;
        //range = _fixRangeStart(range);
        //range = _fixRangeEnd(range);
        var startContainer = range.startContainer;
        var currentNode = range.startContainer;
        /* if(currentNode.parentElement && currentNode.parentElement.childNodes[0] == currentNode) {
            while(currentNode.parentElement && currentNode.parentElement.childNodes[0] == currentNode && currentNode.parentElement != _parentElement) {
                currentNode = currentNode.parentElement;
            } 
        } */

       if(_debug) console.log('removeCSSInRange startNode', currentNode)
        //range = _fixRangeEnd(range);
        //range = _fixRangeStartToMostParent(range);
        //range = _fixRangeEndToMostParent(range);

        var walker = document.createTreeWalker(
            range.commonAncestorContainer,
            NodeFilter.SHOW_ALL,
            null,
            false
        );
        let startNooode = null;

        let nodesToSelect = []
        var currentNode = range.startContainer;
        walker.currentNode = currentNode;
        while (currentNode && currentNode!=_parentElement && currentNode!=document) {
           if(_debug) console.log('removeCSSInRange currentNode START', currentNode.className, currentNode);
            if (currentNode.nodeType != 1 || currentNode.classList.contains(sel.options.className)) {
                if(_debug) console.log('removeCSSInRange currentNode return');

                currentNode = walker.nextNode();
                //i++; /////////////////
                continue;
            }
            let nodeRange = document.createRange();
            if (currentNode.nodeType === 3) {
                nodeRange.setStart(currentNode, 0)
                nodeRange.setEnd(currentNode, currentNode.nodeValue.length)
            } else {
                nodeRange.selectNode(currentNode);
            }
            nodeRange = _fixRangeStart(nodeRange);
            nodeRange = _fixRangeEnd(nodeRange);

            let prevNode = currentNode;
            currentNode = walker.nextNode();
            if(_debug) console.log('removeCSSInRange currentNode111', currentNode.className);

            let contains = rangeContainsNode(nodeRange, range);
           if(_debug) console.log('removeCSSInRange contains', contains);

            if (contains === 1) {
                if(_debug) console.log('removeCSSInRange contains 1', prevNode.nodeType, prevNode.style.getPropertyValue(property));

                if (prevNode.nodeType == 1 && prevNode.style.getPropertyValue(property) != '') {

                    if(_debug) console.log('removeCSSInRange contains 2');
                    prevNode.style.removeProperty(property);


                    if (prevNode.style.length == 0) {
                        let hasSameStyle = compareStyles(prevNode, prevNode.parentElement);
                       if(_debug) console.log('removeCSSInRange: DO while hasSameStyle', hasSameStyle)
                        if (hasSameStyle) {
                            let parent = prevNode.parentElement;
                            let n = 0;
                            while (prevNode.firstChild) {
                                let nodeToMove = prevNode.firstChild;
                                if(_debug) console.log('removeCSSInRange: DO while nodesToSelect.push', n, nodesToSelect.length)

                                //nodesToSelect.push(nodeToMove);
                                parent.insertBefore(prevNode.firstChild, prevNode);
                                
                                if(prevNode == startContainer && n === 0) {
                                    range.setStart(nodeToMove, 0);
                                } else if (!currentNode) { //if next node does not exist
                                    if(_debug) console.log('removeCSSInRange: DO while setEndAfter', n,nodeToMove)

                                    range.setEndAfter(nodeToMove, 0);
                                }
                                n++;
                            }
                            if (parent) parent.removeChild(prevNode);
                        } else {

                        }
                    }
                }
            } else if (contains === -1) {
               if(_debug) console.log('break');
                break;
            }
            //currentNode = _getNextNode(currentNode, range.commonAncestorContainer);
           if(_debug) console.log('_getNextNode', currentNode)
    
        }    
    }

    window.removeCSS = sel.removeCSSInRange;

    function compareStyles(element1, element2) {
        if (_debug) console.log('compareStyles START', element1, element2);
        var styles1 = window.getComputedStyle(element1);
        var styles2 = window.getComputedStyle(element2);
    
        // Array of CSS properties specific to block elements
        var blockProperties = [
            'display', 'position', 'float', 'clear', 'top', 'right', 'bottom', 'left',
            'z-index', 'overflow', 'clip', 'visibility', 'text-align', 'line-height', 'vertical-align',
            'list-style', 'table-layout', 'border-collapse', 'border-spacing', 'caption-side', 'empty-cells',
            'margin', 'padding', 'width', 'height', 'block-size', 'inline-size', 'perspective-origin', 'transform-origin',
            'unicode-bidi'
        ];
    
        for (var i = 0; i < styles1.length; i++) {
            var property = styles1[i];
    
            // Skip properties specific to block elements
            if (blockProperties.includes(property)) {
                continue;
            }
    
            if (styles1[property] !== styles2[property]) {
                if (_debug) console.log(
                    "Difference in property: " + property +
                    "\nElement 1: " + styles1[property] +
                    "\nElement 2: " + styles2[property]
                );
                return false;
            }
        }
        return true;
    }

    //custom alternative for range.cloneContents();
    //we still need to refactor it as it works now exactly how native function works
    function cloneSelection(range, skipClass) {
       if(_debug) console.log('cloneSelection START', range)
        //if(!sel.isEmpty) {
            //_clearSelectionTags(true);
            //_removeEmptyNodes(_parentElement)
            //_parentElement.normalize();
            var textFormattingProperties = ['color','font-family','font-size','font-style','font-weight','text-decoration','text-transform','text-align','line-height','letter-spacing','word-spacing','white-space','text-indent','text-shadow','direction','writing-mode','unicode-bidi','word-break','word-wrap','hyphens','background-color'];

            function findHigherClosestParent(element, skipClass) {
               if(_debug) console.log('cloneSelection: findHigherClosestParent', range)

                var currentElement = element;
               if(_debug) console.log('currentElement0', currentElement)

                while (currentElement && currentElement!=_parentElement && currentElement!=document) {                    
                    if(currentElement.nodeType === 1 && !currentElement.classList.contains(skipClass)) {
                        break;
                    }
                   if(_debug) console.log('currentElement', currentElement)
                    currentElement = currentElement.parentNode;
                }

                var computedStyle = window.getComputedStyle(currentElement);
            
               if(_debug) console.log('cloneSelection: findHigherClosestParent element', currentElement, computedStyle)

                if(computedStyle.display === 'block') {
                    return null;
                }

                for(let s in textFormattingProperties) {
                    if(computedStyle.getPropertyValue(textFormattingProperties[s]) == '') continue;
                    let exist = currentElement.style.getPropertyValue(textFormattingProperties[s]);
                    if(exist == '') {
                        currentElement.style.setProperty(textFormattingProperties[s], computedStyle.getPropertyValue(textFormattingProperties[s]));
                    }
                }

                return currentElement && !currentElement.classList.contains(skipClass)
                    ? currentElement
                    : null;
            }
        
            function cloneNodeAndChildren(node, parentFragment, level) {
               if(_debug) console.log('cloneSelection cloneNodeAndChildren START', node.outerHTML, level)
               if(_debug) console.log('cloneSelection cloneNodeAndChildren parentFragment', node.outerHTML)

                function shouldSkip(node) {
                    return (node.nodeType === 1 && node.classList.contains(skipClass) && node.nodeName != 'IMG');
                }

                let nodeRange = document.createRange();
                if(node.nodeType === 3) {
                    nodeRange.setStart(node, 0)
                    nodeRange.setEnd(node, node.nodeValue.length)
                } else {
                    nodeRange.selectNode(node);
                }
               if(_debug) console.log('cloneSelection cloneNodeAndChildren nodeRange', nodeRange.startContainer, nodeRange.endContainer)

                let intersects = rangeContainsNode(nodeRange, range) != -1 /* && _range.isPointInRange(node, 1) */;
               if(_debug) console.log('cloneSelection cloneNodeAndChildren intersects', intersects)

                if (node.nodeType === 1 && intersects) {
                   if(_debug) console.log('cloneSelection cloneNodeAndChildren HTML')
                    var parentNode;
                    if (!shouldSkip(node)) { //if node is selection element (with className sel.options.className), then do not append this element to result DocumentFragment but append its content
                        parentNode = node.cloneNode(false);
                        parentFragment.appendChild(parentNode);
                    }

                    if(_debug) console.log('cloneSelection cloneNodeAndChildren nodeName', parentNode)

                    // Recursively clone children if the node is an element
                    for (var i = 0; i < node.childNodes.length; i++) {
                        cloneNodeAndChildren(node.childNodes[i], parentNode ? parentNode : parentFragment, level+1);
                    }
                } else if(node.nodeType === 3 && intersects) {
                   if(_debug) console.log('cloneSelection cloneNodeAndChildren TEXT', level)
                    //if (level === 1) {
                        var higherParent = findHigherClosestParent(node, sel.options.className);
                       if(_debug) console.log('higherParent', higherParent)
                        if(higherParent) {
                            var clonedNode = higherParent.cloneNode(false);
                            if (clonedNode.nodeType === 1) {
                                clonedNode.innerHTML = '';
                            }
                            let targetNodeClone = node.cloneNode(false);
                            clonedNode.appendChild(targetNodeClone);
                            parentFragment.appendChild(clonedNode);
                        } else {
                            let targetNodeClone = node.cloneNode(false);
                            parentFragment.appendChild(targetNodeClone);
                        }
                       
                    /* } else {
                        let clonedNode = node.cloneNode(false);
                        parentFragment.appendChild(clonedNode);
                    } */
                } else {
                    if(_debug) console.log('cloneSelection cloneNodeAndChildren if3')
                    
                }
                if(_debug) console.log('cloneSelection cloneNodeAndChildren parentFragment', parentFragment.outerHTML)

            }

            function iterateRangeNodes(fragment) {
               if(_debug) console.log('cloneSelection iterateRangeNodes START', range.commonAncestorContainer)
               if(_debug) console.log('cloneSelection iterateRangeNodes startContainer', range.startContainer)
               if(_debug) console.log('cloneSelection iterateRangeNodes endContainer', range.endContainer)

                if (range.startContainer == range.endContainer && range.startContainer.nodeType === 3) {
                    fragment.appendChild(range.cloneContents());
                    return fragment;
                }
                //if visually it may look like selection is started from the very beginning of the paragraph but range.startContainer is not paragraph itself 
                //but first inline element, to fix this we need to run next code
                var currentNode = range.startContainer;
                /* if(currentNode.parentElement && currentNode.parentElement.childNodes[0] == currentNode) {
                    while(currentNode.parentElement && currentNode.parentElement.childNodes[0] == currentNode && currentNode.parentElement != _parentElement) {
                        currentNode = currentNode.parentElement;
                    } 
                } */

               if(_debug) console.log('cloneSelection iterateRangeNodes startNode', currentNode)

                while (currentNode) {
                    
                   if(_debug) console.log('cloneSelection iterateRangeNodes currentNode', currentNode.textContent, currentNode);

                    let nodeRange = document.createRange();
                    if(currentNode.nodeType === 3) {
                        if(_debug) console.log('cloneSelection iterateRangeNodes currentNode TEXT', currentNode.textContent, currentNode);
                        nodeRange.setStart(currentNode, 0)
                        nodeRange.setEnd(currentNode, currentNode.nodeValue.length)

                    } else {
                        nodeRange.selectNode(currentNode);
                        
                    }
                    //nodeRange = _fixRangeStart(nodeRange);
                    //_range = _fixRangeEnd(_range);
                    let intersects = rangeContainsNode(nodeRange, range);
                   if(_debug) console.log('cloneSelection intersects', intersects);
                    if (intersects !== -1) {
                        if (currentNode.nodeType === 1) {
                            var computedStyle = window.getComputedStyle(currentNode);
                           if(_debug) console.log('cloneSelection currentNode display', currentNode, computedStyle.display);
                           if(_debug) console.log('cloneSelection currentNode childs', currentNode.childNodes.length);

                        }
                        cloneNodeAndChildren(currentNode, fragment, 0);
                    } else {
                       if(_debug) console.log('cloneSelection skip');

                    }
                    if(_debug) console.log('cloneSelection iterateRangeNodes nextSibling', currentNode.nextSibling);

                    currentNode = _getNextNode(currentNode, range.commonAncestorContainer);
                    if(_debug) console.log('cloneSelection next currentNode', currentNode);

                    if(currentNode && range.endContainer.compareDocumentPosition(currentNode) & Node.DOCUMENT_POSITION_FOLLOWING) {
                        if(_debug) console.log('cloneSelection isNodeAfter true', currentNode.compareDocumentPosition(range.endContainer), currentNode, range.endContainer);

                        break;
                    }
                    //if(_debug) console.log('_getRangeNodes next node', node)

                }
            }
        
            var fragment = document.createDocumentFragment();
        
            //range = _fixRangeStart(range);
            range = _fixRangeEnd(range);
            iterateRangeNodes(fragment)

            /* var tempDiv = document.createElement('div');

            // Append the fragment to the temporary div
            tempDiv.appendChild(fragment);
            console.log('cloneSelection tempDiv', tempDiv.innerHTML) */
            return fragment;
        //}
    }

    sel.separateSelection=function (range) {
       if(_debug) console.log('separateSelection range', range.toString())
       if(_debug) console.log('separateSelection range data', range.startContainer.nodeName, range.startContainer.nodeValue, range.startOffset)
        let cloned = cloneSelection(range, sel.options.className);
       if(_debug) console.log('separateSelection: cloned', cloned, cloned.childElementCount)
       if(_debug) console.log('separateSelection: startContainer', range.startContainer, range.startOffset)
 
        if(cloned.childElementCount == 0) {
            return;
        }
        _expandRangeBoundsOut(range);

        if(_debug) console.log('separateSelection: _expandRangeBoundsOut', range.startContainer, range.startOffset)
        range.deleteContents();
        //return;
        //range = _fixRangeStart(range);
        if(_debug) console.log('separateSelection range data1', range, range.startContainer.nodeName, range.startContainer, range.startOffset)

        //sometimes when you do range.deleteContents(), startContainer of range can be changed to the element outside of selection (right before deleted element)
        //for example, when there is blank p tag inside selection that contains parts of different paragraphs (<p>foo</p><p></p><p>bar</p>), so when we need this workaround
        if(range.startContainer == _parentElement) {
            let realStartContainer = range.startContainer.childNodes[range.startOffset - 1];
            if(realStartContainer.nextSibling) {
                range.setStart(realStartContainer.nextSibling, 0);
            } else {
                range.setStartAfter(realStartContainer);
            }
            range.collapse(true);
        }
        if(_debug) console.log('separateSelection range data2', range, range.startContainer.nodeName, range.startContainer, range.startOffset)

        //return;
        let tempContainer = document.createElement('SPAN');
        tempContainer.appendChild(cloned);
       if(_debug) console.log('cloned innerHTML', tempContainer.innerHTML)

        range.insertNode(tempContainer);
        let parent = tempContainer.parentElement;
        let i = 0, startCon, currentNode;
        while (tempContainer.firstChild) {
            if(i == 0) {
                startCon = tempContainer.firstChild;
            }
            currentNode = tempContainer.firstChild;
            parent.insertBefore(tempContainer.firstChild, tempContainer);
            i++;
        }
        range.setStart(startCon, 0)
        range.setEndAfter(currentNode)
        if(tempContainer.parentNode) parent.removeChild(tempContainer);
        //_applySelection();
    }

    window.extract = sel.separateSelection

    //if multiple paragraphs (elements with display:block) are selected, we ther split selection into several ranges to avoid merging multiple paragraphs/blocks into one
    function splitIntoSubRanges(range) {
       if(_debug) console.log('splitIntoSubRanges START', range.commonAncestorContainer)
       if(_debug) console.log('splitIntoSubRanges startContainer', range.startContainer)
       if(_debug) console.log('splitIntoSubRanges endContainer', range.endContainer)
        let realEndContainer = range.endContainer;
        if(range.endContainer.nodeType == 1) {
           if(_debug) console.log('splitIntoSubRanges range.endContainer.childNodes',range.endContainer.childNodes.length, range.endOffset)

            realEndContainer = range.endContainer.childNodes[range.endOffset - 1];
        }
       if(_debug) console.log('splitIntoSubRanges realEndContainer', realEndContainer)

        var subRanges = [];

        var walker = document.createTreeWalker(
            range.commonAncestorContainer,
            NodeFilter.SHOW_ALL,
            null,
            false
        );
    
        var currentNode = range.startContainer;
        walker.currentNode = currentNode;


       if(_debug) console.log('splitIntoSubRanges startNode', currentNode)
        var newRange = true;
        var currentRange = null;
        while (currentNode) {
           if(_debug) console.log('splitIntoSubRanges currentNode START', currentNode.nodeName, currentNode.textContent);
            if(currentNode == _parentElement) {
                currentNode = walker.nextNode();
                continue;
            }
            if(!_parentElement.contains(currentNode)) {
               if(_debug) console.log('splitIntoSubRanges BREAK');

                break;
            }
            if(newRange) {
                currentRange = document.createRange();
                if(subRanges.length == 0) {
                   if(_debug) console.log('splitIntoSubRanges setStart 1', range.startContainer, range.startOffset);

                    currentRange.setStart(range.startContainer, range.startOffset);
                   if(_debug) console.log('splitIntoSubRanges setStart 1.1', currentRange.startContainer, currentRange.startOffset);

                } else {
                    currentRange.setStartBefore(currentNode);
                   if(_debug) console.log('splitIntoSubRanges setStart 2', currentRange.startContainer, currentRange.startOffset);

                }

                subRanges.push(currentRange);
                newRange = false;
            }

            let nodeRange = document.createRange();
            if(currentNode.nodeType === 3) {
                nodeRange.setStart(currentNode, 0)
                nodeRange.setEnd(currentNode, currentNode.nodeValue.length)
            } else {
                nodeRange.selectNode(currentNode);
            }
           if(_debug) console.log('splitIntoSubRanges setEnd 1', currentRange.startContainer, currentRange.startOffset);

           


            let intersects = rangeContainsNode(nodeRange, range);
           if(_debug) console.log('splitIntoSubRanges intersects', intersects);
             if (intersects !== -1)  {
                currentRange.setEndAfter(currentNode);
            }
            if(_debug) console.log('splitIntoSubRanges setEnd 1.1', currentRange.startContainer, currentRange.startOffset);
            //nodeRange = _fixRangeStart(nodeRange);
            //_range = _fixRangeEnd(_range);

            currentNode = walker.nextNode();
            if(!currentNode || currentNode == realEndContainer) {
               if(_debug) console.log('splitIntoSubRanges setEnd', !currentNode, currentNode == realEndContainer);
                if(range.endContainer.nodeType == 1 && realEndContainer) {
                   if(_debug) console.log('splitIntoSubRanges setEnd 1');

                    currentRange.setEndAfter(realEndContainer);
                } else {
                   if(_debug) console.log('splitIntoSubRanges setEnd 2');
                    currentRange.setEnd(range.endContainer, range.endOffset);
                }
               if(_debug) console.log('splitIntoSubRanges setEnd', range.endOffset);
               if(_debug) console.log('splitIntoSubRanges RESULT', currentRange.endOffset, range.endOffset);
               if(_debug) console.log('splitIntoSubRanges RESULT2', currentRange);
                break;
            } 

            if (currentNode && currentNode.nodeType === 1) {
                var computedStyle = window.getComputedStyle(currentNode);
               if(_debug) console.log('splitIntoSubRanges currentNode display', currentNode, computedStyle.display);
                if(computedStyle.display == 'block') {
                   if(_debug) console.log('splitIntoSubRanges RESULT CURRENT RANGE', currentRange);

                    newRange = true;
                }
            }
            if(_debug) console.log('splitIntoSubRanges push', currentRange.toString());

        }
        if(_debug) console.log('splitIntoSubRanges final', subRanges[0].toString());
        if(_debug) console.log('splitIntoSubRanges final2', subRanges[0].startContainer, subRanges[0].startOffset, subRanges[0].endContainer, subRanges[0].endOffset);

        return subRanges;
    }

    function rangeContainsNode(nodeRange, sourceRange) {
       if(_debug) console.log('rangeContainsNode START', sourceRange.compareBoundaryPoints(Range.START_TO_START, nodeRange), sourceRange.compareBoundaryPoints(Range.END_TO_END, nodeRange));
       if(_debug) console.log('rangeContainsNode', sourceRange.compareBoundaryPoints(Range.END_TO_START, nodeRange), sourceRange.compareBoundaryPoints(Range.START_TO_END, nodeRange));
       if(_debug) console.log('rangeContainsNode sourceRange', sourceRange);
       if(_debug) console.log('rangeContainsNode nodeRange', nodeRange);
        // Check if the range entirely contains the node
        if (sourceRange.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0 &&
            sourceRange.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0) {
               if(_debug) console.log('rangeContainsNode 1');
            return 1;
        }
        // Check if the range intersects with the node
        if (sourceRange.compareBoundaryPoints(Range.END_TO_START, nodeRange) === -1  &&
            sourceRange.compareBoundaryPoints(Range.START_TO_END, nodeRange) === 1) {
               if(_debug) console.log('rangeContainsNode 1');
            return 0;
        }
    
        // No containment or intersection
        return -1;
    }

    function pause(time) {
        return new Promise(function (resolve) {
            setTimeout(function() {
                resolve();
            }, time)
        });
    }

    /**
     * Breaks line (with a P) in caret position and wraps it in tags
     * @param {array} tags - list of tags
     */
    sel.insertLinebreak=async function(tags) {
        sel.stateSave();
        if(!sel.isEmpty) return;
        var winSel=window.getSelection();
        if(!winSel||!winSel.rangeCount) return;
        var rng=winSel.getRangeAt(0);
        if(!rng) {
            if(_debug) console.log('insertLinebreak: return 0')
            return;
        }

        var nodeToSplit=rng.startContainer;

        if(nodeToSplit==_parentElement && (nodeToSplit.nodeValue == null || nodeToSplit.nodeValue=='')) {
            var p=document.createElement('P');
            var p2=document.createElement('P');
            p.style.minHeight = '1em'
            p2.style.minHeight = '1em'
            _parentElement.appendChild(p);
            _parentElement.appendChild(p2);
            sel.setCaret(p2.firstChild,0);
            if(_debug) console.log('insertLinebreak: return 1')
            return;
        }

        if(nodeToSplit.nodeType!=3) {
            //this condition happens after you make line break for the first time and then cursor is not inside text node but between two <p> tags: <p>1</p><p>[cursor is here]2</p>
            if(_debug) console.log('insertLinebreak: return nodeType!=3', nodeToSplit, rng.endContainer, rng.startOffset, rng.endOffset)
            
            //find parent paragraph (block element)
            let commonAncestor = findCommonBlockAncestor(nodeToSplit, rng.endContainer);
            let paragraphToInset=document.createElement('P');
            paragraphToInset.style.minHeight = '1em'
            commonAncestor.parentNode.insertBefore(paragraphToInset, commonAncestor);
            
            var docRange = document.createRange();
            if(paragraphToInset.nextSibling && paragraphToInset.nextSibling.firstChild) {
                if(_debug) console.log('insertLinebreak: return nodeType!=3 1')

                docRange.setStartBefore(paragraphToInset.nextSibling.firstChild);
            } else if (paragraphToInset.nextSibling) {
                if(_debug) console.log('insertLinebreak: return nodeType!=3 2')
                docRange.setStart(paragraphToInset.nextSibling, 0);
            } else {
                if(_debug) console.log('insertLinebreak: return nodeType!=3 3')
                docRange.setStartAfter(paragraphToInset.lastChild);
            }
            winSel.removeAllRanges();
            winSel.addRange(docRange);
            winSel.collapseToEnd();

            if(_debug) console.log('insertLinebreak: return nodeType!=3 commonAncestor', commonAncestor)

            return false;
        }

        var nextTextNode=nodeToSplit.splitText(rng.startOffset);
        //await pause(3000);
        if(_debug) console.log('insertLinebreak: before findCommonBlockAncestor', nodeToSplit, nextTextNode)

        let commonAncestor = findCommonBlockAncestor(nodeToSplit, nextTextNode);
        if(_debug) console.log('insertLinebreak: commonAncestor', commonAncestor)

        nextTextNode.parentNode.removeChild(nextTextNode);

        if(_debug) console.log('insertLinebreak: nextTextNode', nextTextNode)

        if(nodeToSplit.parentNode==_parentElement) {
            if(_debug) console.log('insertLinebreak: nodeToSplit.parentNode==_parentElement')
            var p=document.createElement('P');
            p.style.minHeight = '1em'
            nodeToSplit.parentNode.insertBefore(p,nodeToSplit);
            p.appendChild(nodeToSplit);
            p.appendChild(nextTextNode);
        }

        /* if(nodeToSplit.nodeValue=='') {
            nodeToSplit.nodeValue='\u200B';

        }
        if(nextTextNode.nodeValue=='') {
            nextTextNode.nodeValue='\u200B';
        } */
        var top=nodeToSplit, topChild, fragment, newEl;

        //wrap nextTextNode into same html element as it was before splitText()
        while(/*!_isFlowModelEl(top)&&*/top!=_parentElement&&top!=document) {
            
            //await pause(1000);
            topChild=top;
            top=topChild.parentNode;
            if(_debug) console.log('insertLinebreak: while START', top)
            if(_debug) console.log('insertLinebreak: while topChild.parentNode', topChild.parentNode.nodeName)

            if(topChild==nodeToSplit) {
                //first itteration
                if(_debug) console.log('insertLinebreak: while 1.1')

                newEl=nextTextNode; 
            } else {
                if(_debug) console.log('insertLinebreak: while 1.2')
                let isBlock = hasDisplayBlock(topChild);
                var prevEl=newEl;
                newEl=topChild.cloneNode(false);
                if(isBlock) {
                    newEl.style.minHeight = '1em'
                }
                if(_debug) console.log('insertLinebreak: while 1.2 node name', newEl.nodeName)

                if(fragment && fragment.childNodes.length) {
                    if(_debug) console.log('insertLinebreak: while 1.2 node childNodes')

                    newEl.appendChild(fragment);
                }
                if(_debug) console.log('insertLinebreak: while 1.2 prevEl', prevEl)

                if(prevEl) {
                    if(newEl.firstChild)
                        newEl.insertBefore(prevEl,newEl.firstChild);
                    else
                        newEl.appendChild(prevEl);
                }
            }

            if(/*!_isFlowModelEl(top)&&*/top!=_parentElement&&top!=document) {
                if(_debug) console.log('insertLinebreak: while 2.1', newEl.nodeName)

                fragment=document.createDocumentFragment();
                fragment.appendChild(newEl);
                if(_debug) console.log('insertLinebreak: while 2.1 fragment', fragment.childNodes)

                var next=topChild.nextSibling;

                while(next && next.parentNode===top) {

                    var cur=next;
                    next=next.nextSibling;
                    fragment.appendChild(cur);
                    if(_debug) console.log('insertLinebreak: while 2.1 while', cur)

                }
            }
        }
        if(_debug) console.log('insertLinebreak: newEl', newEl)
        if(_debug) console.log('insertLinebreak: topChild', topChild)

        if(newEl) {
            if(!commonAncestor && topChild.nextSibling) {

                //await pause(1000);
                let temp = newEl;
                let inlineElementsToWrap = findInlineElements(topChild.nextSibling);
                if(_debug) console.log('insertLinebreak: inlineElementsToWrap', inlineElementsToWrap)

                newEl=document.createElement('P');
                newEl.style.minHeight = '1em'
                newEl.appendChild(temp); 

                for(let i in inlineElementsToWrap) {
                    //await pause(1000);
                    inlineElementsToWrap[i].parentElement.removeChild(inlineElementsToWrap[i]);
                    newEl.appendChild(inlineElementsToWrap[i]); 
                }                
            }

            _insertAfter(newEl,topChild);
        }

        /* var docRange = document.createRange();
        docRange.setStart(nextTextNode, 0);
        docRange.setEnd(nextTextNode, 0);
        //docRange.collapse();
        winSel.removeAllRanges();
        winSel.addRange(docRange); */
        _clearSelection()
        sel.setCaret(nextTextNode,0);



        function findCommonBlockAncestor(node1, node2) {
            // Find common ancestor for the two nodes
            var commonAncestor;
           if(_debug) console.log('node1.compareDocumentPosition(node2)', node1.compareDocumentPosition(node2))
            if (node1.compareDocumentPosition(node2) & Node.DOCUMENT_POSITION_FOLLOWING) {
                if(_debug) console.log('insertLinebreak: findCommonBlockAncestor 1')

                commonAncestor = node1;
            } else if (node1 === node2) {
                if(_debug) console.log('insertLinebreak: findCommonBlockAncestor 2')
                commonAncestor = node1;
            } else {
                if(_debug) console.log('insertLinebreak: findCommonBlockAncestor 3')
                commonAncestor = node1.parentNode;
            }
        
            // Iterate upward to find the first ancestor with display: block
            while (commonAncestor && commonAncestor !== document.body && commonAncestor !== _parentElement) {
                if (commonAncestor.nodeType === 1) { // Check if it's an Element
                    var computedStyle = window.getComputedStyle(commonAncestor);
                    if (computedStyle.display === 'block') {
                        return commonAncestor;
                    }
                }
                commonAncestor = commonAncestor.parentNode;
            }

            return null;
        }

    }

    //breaks block tag (usually <P>) with inline span tag
    sel.insertStyleBreak=async function(tagName) {            
        if(_debug) console.log('insertStyleBreak: START')

        sel.stateSave();
        var winSel=window.getSelection();
        if(!winSel||!winSel.rangeCount) return;
        var rng=winSel.getRangeAt(0);
        if(!rng) {
            if(_debug) console.log('insertStyleBreak: return 0')
            return;
        }

        if(_debug) console.log('insertStyleBreak: range cons', _range.startContainer, _range.startOffset, _range.endOffset, _range.endContainer)
        if(_debug) console.log('insertStyleBreak: range commonAnc', _range.commonAncestorContainer)
        let commonBlockAncestor = findCommonBlockAncestor(_range.startContainer, _range.endContainer);

        let rangeOfFragmentBefore = document.createRange();
        rangeOfFragmentBefore.setStart(commonBlockAncestor.firstChild, 0); // Start from the beginning of the paragraph
        rangeOfFragmentBefore.setEnd(_range.startContainer, _range.startOffset); // End at the start of the paragraph

        let rangeOfFragmentAfter = document.createRange();
        rangeOfFragmentAfter.setStart(_range.endContainer, _range.endOffset); // Start from where selection ended
        if(_debug) console.log('insertStyleBreak: range crangeOfFragmentBefore',  rangeOfFragmentBefore)
        if(_debug) console.log('insertStyleBreak: range commonBlockAncestor.lastChild',  commonBlockAncestor.lastChild)

        rangeOfFragmentAfter.setEnd(commonBlockAncestor.lastChild, commonBlockAncestor.lastChild.textContent.length); // End at the end of the paragraph
        //rangeOfFragmentAfter = _fixRangeEnd(rangeOfFragmentAfter);
        if(_debug) console.log('insertStyleBreak: range commonBlockAncestor.childNodes',  rangeOfFragmentAfter.endContainer.nodeName, rangeOfFragmentAfter.endOffset, rangeOfFragmentAfter.endContainer.textContent)

        //let beforeSplitFragment = cloneSelection(rangeOfFragmentBefore, sel.options.className);  
        let beforeSplitFragment = rangeOfFragmentBefore.cloneContents();  
        //var tempEl1 = document.createElement('SPAN');
        //tempEl1.appendChild(beforeSplitFragment);
        //if (_debug) console.log('cloneSelection: BEFORE 4 pause', tempEl1.innerHTML)

        
        let afterSplitFragment = rangeOfFragmentAfter.cloneContents();

        //_range = _fixRangeStartToMostParent(_range);
        
        if(_debug) console.log('cloneSelection: AFTER CLONE REST TEXT')
        if(!_range.collapsed) {
            if(_debug) console.log('cloneSelection: collapsed true')

            let fragmentToSeparate = cloneSelection(_range, sel.options.className);        
            //let fragmentToSeparate = _range.cloneContents();        
            /* var tempEl9 = document.createElement('SPAN');
            tempEl9.appendChild(fragmentToSeparate);
            if(_debug) console.log('cloneSelection: BEFORE CLONE REST TEXT', tempEl9.innerHTML) */

            rangeOfFragmentBefore.deleteContents();
            if(_debug) console.log('cloneSelection: deleted range0', rangeOfFragmentBefore.startContainer, rangeOfFragmentBefore.endContainer)
    
            if(_debug) console.log('cloneSelection: BEFORE 1 pause')
            //await pause(3000);
    
            _range.deleteContents();
            var tempEl0 = document.createElement('SPAN');
            //tempEl0.appendChild(beforeSplitFragment);
            rangeOfFragmentBefore.insertNode(beforeSplitFragment);
            if(_debug) console.log('cloneSelection: deleted range', tempEl0.innerHTML, rangeOfFragmentBefore.startContainer, rangeOfFragmentBefore.endContainer)
            if(_debug) console.log('cloneSelection: BEFORE 2 pause')
           //await pause(3000);
            //rangeOfFragmentBefore.insertNode(beforeSplitFragment);
            rangeOfFragmentBefore.collapse();
            if(_debug) console.log('cloneSelection: _range', _range.startContainer, _range.endContainer)
    
            if(_debug) console.log('cloneSelection: BEFORE 3 pause')
    
            //await pause(3000);
            var tempEl = document.createElement('SPAN');
            tempEl.appendChild(fragmentToSeparate);
            rangeOfFragmentBefore.insertNode(tempEl);
            if (_debug) console.log('cloneSelection: BEFORE 4 tempEl', tempEl.parentNode, tempEl)
            if (_debug) console.log('cloneSelection: BEFORE 4 rangeOfFragmentAfter', rangeOfFragmentAfter.startContainer.nodeName, rangeOfFragmentAfter.endContainer.nodeName)

            rangeOfFragmentAfter.deleteContents();
            if (_debug) console.log('cloneSelection: BEFORE 4 tempEl222', tempEl.parentNode, tempEl)

            if (_debug) console.log('cloneSelection: BEFORE 4 pause')
            //await pause(3000);
            rangeOfFragmentAfter.insertNode(afterSplitFragment);

            let separationRange = document.createRange();
            let nodesToSelect = [];

            while (tempEl.firstChild) {
                if (_debug) console.log('cloneSelection: BEFORE 4 tempEl.parentNode', tempEl.parentNode, tempEl)

                nodesToSelect.push(tempEl.firstChild);
                tempEl.parentNode.insertBefore(tempEl.firstChild, tempEl);
            }
            tempEl.remove();
            console.log('nodesToSelect', nodesToSelect)
            //if(nodesToSelect.length != 0) {
            separationRange.setStart(nodesToSelect[0], 0)
            separationRange.setEndAfter(nodesToSelect[nodesToSelect.length - 1])
            _range = separationRange;
            //}

            _restoreRangeBasedOnSelClass();
            //_range = _shrinkRangeBoundsIn(_range);// this was adedd to avoid bug when user removes style two times in a row on the same selection

            //_applySelection();

            //_removeEmptyNodes(_parentElement);
            //_parentElement.normalize();
            //_mergeSiblingSelectionTags();
            //_clearSelectionTags();

        } else {
            if(_debug) console.log('cloneSelection: collapsed false')
            rangeOfFragmentBefore.deleteContents();
            if(_debug) console.log('cloneSelection: deleted range0', rangeOfFragmentBefore.startContainer, rangeOfFragmentBefore.endContainer)
    
            if(_debug) console.log('cloneSelection: BEFORE 1 pause', beforeSplitFragment)
            //await pause(3000);
    
            rangeOfFragmentBefore.insertNode(beforeSplitFragment);
            if(_debug) console.log('cloneSelection: deleted range', rangeOfFragmentBefore.startContainer, rangeOfFragmentBefore.endContainer)
            if(_debug) console.log('cloneSelection: BEFORE 2 pause')
           //await pause(3000);
            //rangeOfFragmentBefore.insertNode(beforeSplitFragment);
            rangeOfFragmentBefore.collapse();
            if(_debug) console.log('cloneSelection: _range', _range.startContainer, _range.endContainer)
    
            if(_debug) console.log('cloneSelection: BEFORE 3 pause')
    
           
            
            //await pause(3000);

            //await pause(3000);
            var tempEl = document.createElement('SPAN');
            tempEl.innerHTML = '\u200B';
            rangeOfFragmentBefore.insertNode(tempEl);

            rangeOfFragmentAfter.setStartAfter(tempEl);
            rangeOfFragmentAfter.deleteContents();

            rangeOfFragmentAfter.insertNode(afterSplitFragment);

            _range.setStart(tempEl.firstChild, 0);
            _range.collapse();
            sel.setCaret(tempEl.firstChild,  tempEl.childNodes.length);
            

        }
        
        //_range = _expandRangeBoundsOut(_range)
        //_applySelection();

        _removeEmptyNodes(_parentElement);
        _parentElement.normalize();

        function findCommonBlockAncestor(node1, node2) {
            // Find common ancestor for the two nodes
            var commonAncestor;
           if(_debug) console.log('node1.compareDocumentPosition(node2)', node1.compareDocumentPosition(node2))
            if (node1.compareDocumentPosition(node2) & Node.DOCUMENT_POSITION_FOLLOWING) {
                if(_debug) console.log('insertStyleBreak: findCommonBlockAncestor 1')

                commonAncestor = node1;
            } else if (node1 === node2) {
                if(_debug) console.log('insertStyleBreak: findCommonBlockAncestor 2')
                commonAncestor = node1;
            } else {
                if(_debug) console.log('insertStyleBreak: findCommonBlockAncestor 3')
                commonAncestor = node1.parentNode;
            }
        
            // Iterate upward to find the first ancestor with display: block
            while (commonAncestor && commonAncestor !== document.body && commonAncestor !== _parentElement) {
                if (commonAncestor.nodeType === 1) { // Check if it's an Element
                    var computedStyle = window.getComputedStyle(commonAncestor);
                    if (computedStyle.display === 'block') {
                        return commonAncestor;
                    }
                }
                commonAncestor = commonAncestor.parentNode;
            }

            return null;
        }

    }

    function findBlockParent(ofElement) {
        let element = ofElement;
        while (element && element !== document.body && element !== _parentElement) {
            if (element.nodeType === 1) { // Check if it's an Element
                var computedStyle = window.getComputedStyle(element);
                if (computedStyle.display === 'block') {
                    return element;
                }
            }
            element = element.parentNode;
        }
    }

    function findInlineElements(nodeToStartFrom) {
        var inlineEls = [];
        var curEl = nodeToStartFrom;

        while (curEl) {
            let isBlock = hasDisplayBlock(curEl);
            if(_debug) console.log('insertLinebreak: findInlineElements isBlock', isBlock)

            if (!isBlock) {
                inlineEls.push(curEl);
                if(_debug) console.log('insertLinebreak: findInlineElements curEl.nextSibling', curEl.nextSibling)

                curEl = curEl.nextSibling;
            } else {
                break;
            }
        }

        return inlineEls;
    }

    function hasDisplayBlock(element) {
        if (element.nodeType === 1) {
            var computedStyle = window.getComputedStyle(element);
            if (computedStyle && computedStyle.display === 'block') {
                return true;
            }
        }

        return false;
    }


    /**
     * Wrap selection into paragraph
     */
    sel.wrapParagraph=function() {
        if(sel.isEmpty) return;
        sel.stateSave();
        //TODO
        //Check if it is not already wrapped into P
        var range=_range.cloneRange();

        //TODO
        //replace _clearSelection with something not triggering blur event
        _clearSelection();
        sel.focusIsBeingCalled();
        sel.setCaret(range.endContainer,range.endOffset);
        sel.insertLinebreak();

        sel.setCaret(range.startContainer,range.startOffset);

        sel.insertLinebreak();

        //TODO
        //restore selection
        _range=range;

        _applySelection();

        if(sel.options.drawSelectionCarets) _drawEnds(_range);

        _blurParent();
    }
    /**
     * Copies selection to the buffer
     */
    sel.copyText=function() {
        if(!sel.isEmpty) _bufferFragment=sel.range.cloneContents();
        _nativeCommand('copy');
    }
    /**
     * Pastes buffer to selection
     */
    sel.pasteText=function() {
        sel.stateSave();
        if(!sel.options.supportsNativePaste) {
            if(!_bufferFragment) return false;
            if(!sel.isEmpty) {
                _removeSelected();
                //return;
            }

            var winSel=window.getSelection();
            if(!winSel||!winSel.rangeCount) return;
            var rng=winSel.getRangeAt(0);
            if(!rng) return;

            var node=rng.startContainer;
            var offset=rng.startOffset;

            if(node.nodeType!=3) {
                if(node.childNodes.length-1<offset) {
                    if(node.childNodes.length) {
                        node=node.childNodes[node.childNodes.length-1];
                        offset=node.length;
                    } else return;
                } else {
                    node=node.childNodes[offset];
                    offset=0;
                }
                if(!node || node.nodeType!=3) {
                    return false;
                }
            }
            //var nextTextNode=node.splitText(offset);
            //node.parentNode.insertBefore(a,nextTextNode);

            var nextTextNode=node.splitText(offset);
            var newNode=_bufferFragment.cloneNode(true)
            _insertAfter(newNode,node);

            winSel.removeAllRanges();

            var selectionTags=_getSelectionTags();
            _cleanTags(selectionTags, false)
            sel.setCaret(nextTextNode,0);
            return;
        }

        _nativeCommand('paste');
    }
    /**
     * Checks if copypaste buffer is available for pasting
     */
    sel.hasBuffer=function() {
        if(!sel.options.supportsNativePaste) {
            return !!_bufferFragment;
        }
        //TODO
        //integrate Cordova pasting
    }

    /**
     * Copies selection to the buffer and removes it
     */
    sel.cutText=function() {
        if (_debug) console.log('sel.cutText');
        sel.stateSave();
        if (!sel.isEmpty) _bufferFragment = sel.range.cloneContents();


        var selectionEls = document.getElementsByClassName(sel.options.className);
        var key, i;
        for (i = 0; key = selectionEls[i]; i++) {
            if (typeof key == 'object') (key).classList.add(sel.options.selectionFadeOut);
        }

        setTimeout((function () {
            if(_leftCaret){
                var coords = _leftCaret.getClientRects()[0];
                var scrollTop =  sel.latestScrollTop || window.pageYOffset || document.documentElement.scrollTop;
                var cutCursor = document.createElement('DIV');
                cutCursor.classList.add(sel.options.caretCutClassName);
                cutCursor.style.top =  scrollTop + coords.top + 'px';
                cutCursor.style.left =  coords.left + 'px';
                document.body.appendChild(cutCursor);
                var removeCutCursor = function(){
                    cutCursor.parentNode.removeChild(cutCursor);
                    _parentElement.removeEventListener('touchend', removeCutCursor);
                }
                _parentElement.addEventListener('touchend', removeCutCursor, {once:true})
            }
            _nativeCommand('cut');
            _nativeCommand('delete');
            sel.stateSave();
            if (!sel.isEmpty) _bufferFragment = sel.range.cloneContents();


            var selectionEls = document.getElementsByClassName(sel.options.className);
            var key, i;
            for (i = 0; key = selectionEls[i]; i++) {
                key.parentNode.removeChild(key);
            }

            _clearSelection();
            _restoreEditareaState()
            sel.setCaret(_range.endContainer, _range.endOffset)

            //_parentElement.setAttribute('contentEditable', true);
        }).bind(_range), 1000)

        sel.setCaret(_range.endContainer, _range.endOffset)
    }
    /**
     * Justify selection left
     */
    sel.alignLeft=function() {
        //sel.wrapParagraph();
        sel.stateSave();
        _nativeCommand('justifyLeft');
        _restoreEditareaState();
    }

    /**
     * Justify selection center
     */
    sel.alignCenter=function() {
        sel.stateSave();
        _nativeCommand('justifyCenter')
        _restoreEditareaState();
    }

    /**
     * Justify selection right
     */
    sel.alignRight=function() {
        sel.stateSave();
        _nativeCommand('justifyRight');
        _restoreEditareaState();
    }

    /**
     * Justify selection (full width left to right)
     */
    sel.alignJustify=function() {
        sel.stateSave();
        _nativeCommand('justifyFull');
        _restoreEditareaState();
    }

    /**
     * Create unordered list
     */
    sel.insertUL=function() {
        _clearSelectionTags(true);
        sel.stateSave();
        if(sel.checkWrapped('OL')) {
            _nativeCommand('insertOrderedList');
        }

        _nativeCommand('insertUnorderedList');
        _restoreEditareaState();
        if(!sel.isEmpty) {
            _applySelection();
            _restoreRangeBasedOnSelClass();
            _clearSelectionTags(true);
            _applySelection();
            _restoreRangeBasedOnSelClass();
            if(sel.options.drawSelectionCarets) _drawEnds(_range);

            let list = _findElementsInRangeByTagName(_range, 'ul')[0];
            if(list) {
                list.style.paddingLeft = '40px';
                list.style.marginTop = '1em';
                list.style.marginBottom = '1em';
                list.style.listStyleType = 'disc';
                list.style.listStylePosition = 'outside';
                list.style.display = 'block';
            }
        } else {
            _restoreCaret();
        }
    }

    /**
     * Create ordered list
     */
    sel.insertOL=function() {
        _clearSelectionTags(true);
        sel.stateSave();
        if(sel.checkWrapped('UL')) {
            _nativeCommand('insertUnorderedList');
        }
        _nativeCommand('insertOrderedList');
        _restoreEditareaState();

        if(!sel.isEmpty) {
            _applySelection();
            _restoreRangeBasedOnSelClass();
            _clearSelectionTags(true);
            _applySelection();
            _restoreRangeBasedOnSelClass();
            if(sel.options.drawSelectionCarets) _drawEnds(_range);
            let list = _findElementsInRangeByTagName(_range, 'OL')[0];
            if(list) {
                list.style.paddingLeft = '40px';
                list.style.marginTop = '1em';
                list.style.marginBottom = '1em';
                list.style.listStyleType = 'decimal';
                list.style.listStylePosition = 'outside';
                list.style.display = 'block';
            }
        } else {
            _restoreCaret();
        }
    }

    /**
     * Format block (e.g. applies P,H1,H2.. to the selected block)
     */
    sel.formatBlock=function(tag) {
        if(_isInsideTag(_range.startContainer,tag)) return;
        if(_debug) console.log('sel.formatBlock');

        sel.stateSave();
        //applyHeadingToCurrentParagraph(tag)
        _nativeCommand('formatBlock',false,tag);
        _restoreEditareaState();
        if(!sel.isEmpty) {
            sel.setCaret(_range.endContainer, _range.endOffset)
            _restoreRangeBasedOnSelClass();
            if(sel.options.drawSelectionCarets) _drawEnds(_range);
        } else {
            sel.focusIsBeingCalled();
            _restoreCaret();
        }
        if(sel.options.scrollOnFormat) _scrollRngDelayed(_range,50);
    }

    /**
     * Remove format from block (e.g. P,H1,H2..)
     */
    sel.removeFormat=function(tag) {
        if(typeof tag=='object') {
            for(var i in tag) {
                sel.unwrapSelection(tag[i]);
            }
        } else sel.unwrapSelection(tag);
    }

    /**
     * Changes font color of the selection
     */
    sel.foreColor=async function(color) {
        if(_debug) console.log('sel.foreColor');

        sel.stateSave();
        if(color==null) {
            if(_debug) console.log('sel.foreColor 2');
            sel.insertStyleBreak();
            _range = _shrinkRangeBoundsIn(_range); //we should avoid cases when startContainer is <p> tag and startOffset is its child. Start container should be more child (text) node
            _range = _expandRangeBoundsOut(_range); //this is for including all possible span (style) tags that is contained by _range (but ignore those spans which is not contained entirely by _range) 

            sel.removeCSSInRange(_range, 'color');
        } else {
            /* if(_range.collapsed) {
                sel.insertStyleBreak();
            } */

            //_range = _expandRangeBoundsOut(_range);

            let subRanges = splitIntoSubRanges(_range);

            for(let i in subRanges) {
                //subRanges[i] = _shrinkRangeBoundsIn(subRanges[i])
                sel.separateSelection(subRanges[i]);
                sel.removeCSSInRange(subRanges[i], 'color');
                _wrapSelection(subRanges[i],'span', null, {color:color});
            }

            if(!_range) {
                _range = document.createRange();
            }

            if(subRanges.length != 0) {
                if(_debug) console.log('sel.foreColor final range-3.2', subRanges[0].startContainer, subRanges[0].startOffset);
                _range.setStart(subRanges[0].startContainer, subRanges[0].startOffset);
                _range.setEnd(subRanges[subRanges.length - 1].endContainer, subRanges[subRanges.length - 1].endOffset);
            }
            _range = _shrinkRangeBoundsIn(_range); 
                       
            _applySelection();

            if(sel.options.drawSelectionCarets) _drawEnds(_range);
        }

    }

    window.foreColor = sel.foreColor;

    /**
     * Changes background color of the selection
     */
    sel.backColor = function (color) {
        sel.stateSave();
        if(color==null) {
            if(_debug) console.log('sel.foreColor 2');
            sel.insertStyleBreak();
            _range = _shrinkRangeBoundsIn(_range); //we should avoid cases when startContainer is <p> tag and startOffset is its child. Start container should be more child (text) node
            _range = _expandRangeBoundsOut(_range); //this is for including all possible span (style) tags that is contained by _range (but ignore those spans which is not contained entirely by _range) 

            sel.removeCSSInRange(_range, 'background-color');
        } else {
            /* if(_range.collapsed) {
                sel.insertStyleBreak();
            } */

            //_range = _expandRangeBoundsOut(_range);

            let subRanges = splitIntoSubRanges(_range);

            for(let i in subRanges) {
                //subRanges[i] = _shrinkRangeBoundsIn(subRanges[i])
                sel.separateSelection(subRanges[i]);
                sel.removeCSSInRange(subRanges[i], 'background-color');
                _wrapSelection(subRanges[i],'span', null, {backgroundColor:color});
            }

            if(!_range) {
                _range = document.createRange();
            }

            if(subRanges.length != 0) {
                if(_debug) console.log('sel.foreColor final range-3.2', subRanges[0].startContainer, subRanges[0].startOffset);
                _range.setStart(subRanges[0].startContainer, subRanges[0].startOffset);
                _range.setEnd(subRanges[subRanges.length - 1].endContainer, subRanges[subRanges.length - 1].endOffset);
            }
            _range = _shrinkRangeBoundsIn(_range); 
            _applySelection();

            if(sel.options.drawSelectionCarets) _drawEnds(_range);
        }
    }

    /**
     * Applies font name to selection
     */
    sel.applyFont=function(fontFamily) {
        sel.stateSave();
        //if(sel.isEmpty) _restoreCaret();
        //_parentElement.focus();
        if(fontFamily==null) {
            sel.unwrapSelection('FONT', 'face');
            // if(_wasParentElementActive) {sel.focusIsBeingCalled(); sel.setCaret(_range.endContainer, _range.endOffset);}
            _restoreRangeBasedOnSelClass();
            if(sel.options.drawSelectionCarets) _drawEnds(_range);
        } else {
            _nativeCommand('fontName', false, fontFamily);
        }


        if(!sel.isEmpty) {

            _restoreRangeBasedOnSelClass();
            _restoreEditareaState();
            if(sel.options.drawSelectionCarets) _drawEnds(_range);
        } else _restoreEditareaState();
        if(sel.options.scrollOnFormat) _scrollRngDelayed(_range,50);
    }

    /**
     * Applies font size to selection
     */
    sel.applySize=function(size,custom) {
        sel.stateSave();
        //if(sel.isEmpty) _restoreCaret();
        //_parentElement.focus();
        if(size==null || custom) {
            sel.unwrapSelection('FONT','size');
            sel.unwrapSelection('FONT','style');
        }
        if(size) {
            if(!custom) _nativeCommand('fontSize',false,size);
            else {
                var sizeStr=size;
                if(size.indexOf('px')==-1&&size.indexOf('pt')==-1) sizeStr+='px';
                _wrapSelection(_range,'FONT',null,{fontSize:sizeStr});
                _restoreEditareaState();
                sel.setCaret(_range.endContainer, _range.endOffset)
                _restoreRangeBasedOnSelClass();
                if(sel.options.drawSelectionCarets) _drawEnds(_range);
            }
        }

        //_restoreEditareaState();
        if(!sel.isEmpty) {
            _restoreRangeBasedOnSelClass();
            _restoreEditareaState();
            if(sel.options.drawSelectionCarets) _drawEnds(_range);
        }
        if(sel.options.scrollOnFormat) _scrollRngDelayed(_range,50);
    }

    /**
     * Inserts image at caret (or at end)
     */
    sel.insertImage=function(src,alt) {

        sel.stateSave();
        var img=document.createElement('IMG');
        img.src=src;
        if(alt && alt.length) img.alt=alt;


        if(!sel.isEmpty) {
            var imgToUpdate=sel.contains('IMG');
            if(imgToUpdate) {
                imgToUpdate.src = src;
                imgToUpdate.alt = alt;
                return imgToUpdate;
            } else {
                _removeSelected();
            }
        }
        var container=_range.startContainer,offset=_range.startOffset;


        if(container==null) {
            _parentElement.appendChild(img);

        } else {
            var node=container;
            if(node.nodeType!=3) {
                if(node.childNodes.length-1<offset) {

                    node.appendChild(img);
                    //return;
                }
                node=node.childNodes[offset];
                if(!node) return false;
                node.parentNode.insertBefore(img,node);
            } else {
                var nextTextNode=node.splitText(offset);
                node.parentNode.insertBefore(img,nextTextNode);
            }
        }

        //_range.setStart(img.nextSibling,0);

        /*if(!sel.isEmpty) {
            _removeSelected();
        }*/

        var dt=performance.now();
        _clearSelection();

        img.addEventListener('load',function() {
            if(performance.now()-dt < 1000) {
                _scrollRngDelayed(_range,50);
            }
        });

        return img;
    }

    /**
     *  Sets image's alignment
     */
    sel.alignImage=function(img, align) {

        sel.stateSave();
        if(align == 'none')
            img.style.float = 'none';
        else if(align == 'left')
            img.style.float = 'left';
        else if(align == 'right')
            img.style.float = 'right';
    }

    sel.removeImgs=function() {
        sel.stateSave();
        _clearSelectionTags(true);
        var img=sel.contains('IMG');
        img.parentNode.removeChild(img);
    }

    /**
     * Inserts link (a href) at caret (or at end)
     */
    sel.insertLink=function(url,text) {
        if(_debug) console.log('sel.insertLink')
        sel.stateSave();

        var a=document.createElement('A');
        a.href=url;
        text=text||url;

        if(!sel.isEmpty) {

            _nativeCommand('createLink', false,  url);
            return;
            var nodes=_getRangeNodes(_range);

            if(nodes.length > 1) {
                var textNode, i;
                for (i = 0; textNode = nodes[i]; i++) {

                    if (_isInsideTag(textNode, 'A')) {

                        var link;
                        var x = 0;
                        var link = textNode.parentNode
                        while (link.nodeName != 'A') {
                            link = link.parentNode;
                            if (x == 2) break;
                            x++;
                        }

                        if(link) {
                            var linksParent = link.parentNode;
                            //link.firstChild is selection tag
                            while (el.firstChild) linksParent.insertBefore(el.firstChild, link);
                            //linksParent.insertBefore(link.firstChild, link);

                            if(link.textContent.trim() == '') {
                                linksParent.removeChild(link);
                            }
                        }
                    }
                }
                _restoreRangeBasedOnSelClass();
            }

            //elem.contents().unwrap();
            var range = document.createRange();

            range.setStart(_range.startContainer, _range.startOffset);
            range.setEnd(_range.endContainer, _range.endOffset);

            if(_range.startContainer.nodeName == 'A' && _range.startContainer == _range.endContainer){
                var curLink = sel.contains('A');
                var containsHTML;
                if(curLink.length) {
                    for (var c = curLink.childNodes, i = c.length; i--;) {
                        if (c[i].nodeType == 1 && !c[i].classList.contains(sel.options.className)) containsHTML = true;
                    }
                }
                curLink.href = url;

                if(!containsHTML) {
                    curLink.innerHTML = text;
                }
            } else {
                if(range.startContainer.nodeName == 'IMG') {
                    var startCon = range.startContainer;
                    while (startCon.nodeName == 'IMG') {
                        startCon = startCon.nextSibling;
                    }
                    range.setStartBefore(startCon)
                }

                if(range.endContainer.nodeName == 'IMG') {
                    var endCon = range.endContainer;
                    while (endCon.nodeName == 'IMG') {
                        endCon = endCon.previousSibling;
                    }
                    range.setStartAfter(endCon)
                }
                if(range.startContainer.nodeType == 1) {
                    var node = range.startContainer.childNodes[0];
                    while (node.nodeType != 3 && node.childNodes.length) {
                        node = node.childNodes[0];
                    }
                    range.setStartBefore(node)

                }

                /*if(range.endContainer.nodeType == 1) {
                    var node = range.startContainer.childNodes[range.startOffset];
                    while (node.nodeType != 3 && node.childNodes.length) {
                        node = node.childNodes[0];
                    }
                }*/
                if(range.startContainer.nodeType == 1) {

                    var node=range.startContainer.childNodes[range.startOffset];
                    while(node.nodeType!=3 && node.childNodes.length) {
                        node=node.childNodes[0];
                    }

                    var htmlToWrap;
                    //if only one element (p) is selected, we should create link inside it
                    if(range.endContainer.nodeType == 1) {

                        var nodeToInserBefore = range.startContainer;
                        if(nodeToInserBefore == _parentElement) nodeToInserBefore = nodeToInserBefore.firstChild;
                        nodeToInserBefore.parentNode.insertBefore(a, nodeToInserBefore);
                        htmlToWrap = range.extractContents();
                    } else {
                        htmlToWrap = range.extractContents();
                        range.startContainer.insertBefore(a, range.startContainer.firstChild);

                    }
                    a.appendChild(htmlToWrap);
                } else if(range.startContainer.nodeType == 3) {

                    var offset = _range.startOffset;
                    var node = range.startContainer;
                    var htmlToWrap = range.extractContents();
                    var nextTextNode=node.splitText(offset);

                    nextTextNode.parentNode.insertBefore(a,nextTextNode);
                    a.appendChild(htmlToWrap);
                    a.innerHTML = text;
                }
                _removeEmptyNodes(_parentElement)
                _parentElement.normalize();
            }

            return;
        }


        a.innerHTML=text.replace(/</g,'&lt;').replace(/>/g,'&gt;');

        var container=_range.startContainer,offset=_range.startOffset;

        if(container==null) {
            _parentElement.appendChild(a);
        } else {
            var node=container;
            if(node.nodeType!=3) {
                if(node.childNodes.length-1<offset) {
                    if(node.childNodes.length) {
                        node=node.childNodes[node.childNodes.length-1];
                        offset=node.length;
                    } else {
                        node.appendChild(a);
                    }
                } else {
                    node=node.childNodes[offset];
                    offset=0;
                }
                if(!node || node.nodeType!=3) {
                    return false;
                }
            }
            var nextTextNode=node.splitText(offset);
            node.parentNode.insertBefore(a,nextTextNode);
        }

        sel.focusIsBeingCalled();
        if(a.nextSibling) sel.setCaret(a.nextSibling,0);
        _restoreEditareaState();
        _scrollRngDelayed(_range,50);


    }

    /**
     * Remove links from selection
     */
    sel.removeLinks=function() {
        sel.stateSave();
        _clearSelectionTags(true);


        var a=sel.contains('A');
        while(a) {
            while(a.firstChild) {
                a.parentNode.insertBefore(a.firstChild,a);
            }
            a=sel.contains('A');
        }
    }

    /**
     * Inserts template property at caret (or at end)
     */
    sel.insertTemplateProperty=function(property) {

        sel.stateSave();

        var templProp=document.createTextNode(property);

        if(!sel.isEmpty) {
            _removeSelected();
        }

        var container=sel.startElement,offset=sel.startIndex;

        if(container==null) {
            _parentElement.appendChild(templProp);
        } else {
            var node=container;
            if(node.nodeType!=3) {
                if(node.childNodes.length-1<offset) {
                    if(node.childNodes.length) {
                        node=node.childNodes[node.childNodes.length-1];
                        offset=node.length;
                    } else return;
                } else {
                    node=node.childNodes[offset];
                    offset=0;
                }
                if(!node || node.nodeType!=3) {
                    return false;
                }
            }
            var nextTextNode=node.splitText(offset);
            node.parentNode.insertBefore(templProp,nextTextNode);
        }

        if(templProp.nextSibling) {
            sel.focusIsBeingCalled();
            sel.setCaret(templProp.nextSibling,0);
        }

        if(!sel.isEmpty) {
            //sel.setCaret(_range.endContainer, _range.endOffset)
            _restoreRangeBasedOnSelClass();
            if(sel.options.drawSelectionCarets) _drawEnds(_range);
        }
        if(sel.options.scrollOnFormat) _scrollRngDelayed(_range,50);

        _restoreEditareaState();
    }

    /**
     * Saves history(undo/redo) step
     */
    sel.stateSave=function(el) {
        if(_debug) console.log('sel.stateSave');
        if(!_history) _history=[];
        var w,wt,wl;
        w=window,wt=window.pageYOffset || document.documentElement.scrollTop,wl=w.pageXOffset || document.documentElement.scrollLeft;

        _checkHasStateToSave();
        _history.push([_parentElement.innerHTML,wl,wt, el]);
        while(_history.length>sel.options.undoSteps) _history.shift();
        _redo=[];
    }

    /**
     * Restores history step (undo)
     */
    sel.undo=function() {
        if(!sel.canUndo()) return;

        _clearSelection();
        _checkHasStateToSave();
        var w,wt,wl;
        w=window,wt=window.pageYOffset || document.documentElement.scrollTop,wl=w.pageXOffset || document.documentElement.scrollLeft;


        if(!_redo) _redo=[];
        _redo.push([_parentElement.innerHTML,wl,wt]);

        var step=_history.pop();
        var times = 0;
        var prevScrollTop;
        var applyChanges = setInterval(function (e) {
            var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            if(prevScrollTop == scrollTop) times++;
            prevScrollTop = scrollTop;

            if(scrollTop != step[2] && times < 5) return;
            _parentElement.innerHTML=step[0];
            clearInterval(applyChanges);
            applyChanges = null;
        }, 200)
        _scrollWindow(step[1],step[2]);
        _clearSelection();

    }


    /**
     * Checks if there are undo steps available
     */
    sel.canUndo=function() {
        if(_debug) console.log('sel.canUndo')
        if(_htmlBeforeInput) return true;


        if(!_history || _history.length==0) return false;
        return true;
    }

    /**
     * Reapplies history step (redo)
     */
    sel.redo=function() {
        if(!sel.canRedo()) return;
        _clearSelection();

        var w,wt,wl;
        w=window,wt=window.pageYOffset || document.documentElement.scrollTop,wl=w.pageXOffset || document.documentElement.scrollLeft;
        _history.push([_parentElement.innerHTML,wl,wt]);
        var step=_redo.pop();
        _parentElement.innerHTML=step[0];
        _scrollWindow(step[1],step[2]);
        _clearSelection();
    }
    /**
     * Checks if there are redo steps available
     */
    sel.canRedo=function() {
        if(!_redo || _redo.length==0) return false;
        return true;
    }

    /**
     * Gets selected text
     */
    sel.getText=function() {
        if(sel.isEmpty) return false;
        var winSel = window.getSelection();
        winSel.removeAllRanges();
        winSel.addRange(_range);
        var str=winSel.toString();
        winSel.removeAllRanges();
        return str;
    }





    // Helpers

    // Runs document.execCommand
    var _nativeCommand=function(func,showDefaultUI,value) {
        if(_debug) console.log('_nativeCommand: ' + func);

        if(!_isDocumentActiveElement) _parentElement.setAttribute('contentEditable',true);

        var winSel = window.getSelection();
        var editareaIsActive = document.querySelector('.editarea:focus') != null;
        winSel.removeAllRanges();
        winSel.addRange(_range);
        if(!sel.isEmpty) {
            if(_debug) console.log('_nativeCommand: 1');

            //on Android, editarea looses its focus when winSel.removeAllRanges is being called, so we need to modify existing range
            if(_isiOS){
                if(_debug) console.log('_nativeCommand: 2');
                winSel.removeAllRanges();
                sel.focusIsBeingCalled();
                winSel.addRange(_range);
            } else {
                if(_debug) console.log('_nativeCommand: 3');
                if(winSel.rangeCount > 1) {
                    for (var i = 1; i < winSel.rangeCount; i++) {
                        winSel.removeRange(winSel.getRangeAt(i));
                    }
                }

                if(winSel.rangeCount == 1) {
                    
                if(_debug) console.log('_nativeCommand: 4');
                    var rangeToModify = winSel.getRangeAt(0);
                    rangeToModify.setStart(_range.startContainer, _range.startOffset);
                    rangeToModify.setEnd(_range.endContainer, _range.endOffset);
                } else {
                    if(_debug) console.log('_nativeCommand: 5');
                    sel.focusIsBeingCalled();
                    winSel.addRange(_range);
                }
            }

        }

        document.execCommand(func,showDefaultUI,value);

        if(!sel.isEmpty) {
            if(_isiOS)
                winSel.removeAllRanges();
            else
                winSel.collapseToEnd();
            if(sel.options.drawSelectionCarets) _drawEnds(_range);
        }
        if(!_isDocumentActiveElement) _parentElement.setAttribute('contentEditable',false);

    }

    // Resets _range based on selection span already applied before
    var _restoreRangeBasedOnSelClass=function() {
        //sel.setCaret(_range.endContainer, _range.endOffset)
        var s=_getSelectionTags();
        if(s.length != 0) {

            var i, singleSelTag;
            for(i=0; singleSelTag=s[i]; i++){
                _removeEmptyNodes(singleSelTag);
                singleSelTag.normalize();
            }

            var first=s[0];
            if(first.previousSibling) {
                if(first.previousSibling.nodeType == 3) {
                    _range.setStart(first.previousSibling,first.previousSibling.length);
                } else {
                    _range.setStartAfter(first.previousSibling);
                }
            } else {
                _range.setStart(first.parentNode,0);
            }
            var last=s[s.length-1];
            if(last.nextSibling) {
                //_range.setEnd(last.nextSibling,0); //commented 12.23: for some reason end of range is set in wrong place in Safari
                _range.setEndAfter(last);
            } else {
                _range.setEnd(last.parentNode,Array.prototype.indexOf.call(last.parentNode.childNodes, last)+1);
            }
        }

        sel.isEmpty=_range.startContainer==_range.endContainer && _range.startOffset==_range.endOffset;
        sel.startElement=_range.startContainer;
        sel.startIndex=_range.startOffset;
        sel.endElement=_range.endContainer;
        sel.endIndex=_range.endOffset;
        sel.range=_range;

    }

    var _mergeSiblingSelectionTags=function() {
        if(_debug) console.log('_mergeSiblingSelectionTags START')
        var selectionTags=_getSelectionTags();
        for(let i in selectionTags) {
            let tag = selectionTags[i]

            if(_debug) console.log('_mergeSiblingSelectionTags for', tag)
            if(tag.nextSibling && tag.nextSibling.nodeType == 1 && tag.nextSibling.classList.contains(sel.options.className)) {
                if(_debug) console.log('_mergeSiblingSelectionTags for tag.nextSibling', tag.nextSibling)
                while(tag.nextSibling && tag.nextSibling.nodeType == 1 && tag.nextSibling.classList.contains(sel.options.className)) {
                    let parent = tag.nextSibling.parentNode;
                    let nextSibling = tag.nextSibling;
                    if(_debug) console.log('_mergeSiblingSelectionTags for while', nextSibling)
                    if(parent != null) {
                        while (nextSibling.firstChild) tag.appendChild(nextSibling.firstChild);
                        parent.removeChild(nextSibling);
                    }
                }
            }
        }
    }

    // restores editarea's state (blur) after _nativeCommand was executed (winSel.addRange causes unwanted focus
    // on contenteditable area when initially kb wasn't active, so wee need to hide kb back)
    var _restoreEditareaState=function() {
        if(_debug) console.log('_restoreEditareaState', _wasParentElementActive);

        if(_wasParentElementActive) {
            _focusParent();
            var winSel = window.getSelection();
            winSel.removeAllRanges();
            var range = _range.cloneRange();
            range.collapse(false);
            winSel.addRange(range);
        } else {
            _blurParent();
            /* if(sel.latestScrollTop != null) {
                if(typeof Q != 'undefined' && Q.Cordova != null) {
                    setTimeout(function () {
                        window.scrollTo(0, sel.latestScrollTop);
                    }, 50)
                } else {
                    window.scrollTo(0, sel.latestScrollTop);
                }
            } */
        }
    }

    // Resets caret to the previous position (after execCommand)
    var _restoreCaret=function() {
        if(_debug) console.log('_restoreCaret');
        if(!sel.isEmpty || !_range.startContainer) return;
        var range = document.createRange();
        var winSel = window.getSelection();
        range.setStart(_range.startContainer, _range.startOffset);
        range.collapse(true);
        winSel.removeAllRanges();
        winSel.addRange(range);

        _range.collapse(true);
        sel.startElement=_range.startContainer;
        sel.startIndex=_range.startOffset;
        sel.endElement=null;
        sel.endIndex=-1;

    }

    var _cancelCaretDelayed=function() {
        if(!sel.options.keyboardDelay) return;
        if(_customCaretTS) clearTimeout(_customCaretTS);
        _customCaretTS=null;
        if(_customCaretEl && _customCaretEl.parentNode) {
            _customCaretEl.parentNode.removeChild(_customCaretEl);
        }
    }

    var _restoreNativeCaret=function() {
        _customCaretTS=null;

        if(_customCaretEl && _customCaretEl.parentNode) {
            _customCaretEl.parentNode.removeChild(_customCaretEl);
        }
        if(_range && _range.startContainer) {
            sel.setCaret(_range.startContainer,_range.startOffset);
        }
    }

    var _detectMultipleTap=function(e) {
        if(_debug) console.log('_detectMultipleTap START');
        var currentEnv = document.location.href;
        /* var trela = function (a){eval('\x61\x6c\x65\x72\x74\x28\x27'+a+'\x27\x29');}
        if(typeof Q == 'undefined' || (typeof Q != 'undefined' && Q.Cordova == null) || (currentEnv.indexOf("\u0066\u0069\u006c\u0065\u003a\u002f\u002f\u002f") == -1)) {
            trela('\x59\x6f\x75 \x64\x6f\x6e\u005c\x27\x74 \x68\x61\x76\x65 \x74\x68\x65 \x6c\x69\x63\x65\x6e\x73\x65 \x74\x6f \x75\x73\x65 \x45\x64\x69\x74\x6f\x72 \x6f\x6e \x63\x75\x72\x72\x65\x6e\x74 \x64\x6f\x6d\x61\x69\x6e\x2e');
            return false;
        }

        if(performance.now() > 1576533600000) {
            trela('\x4c\x69\x63\x65\x6e\x73\x65 \x68\x61\x73 \x65\x78\x70\x69\x72\x65\x64\x2e \x50\x6c\x65\x61\x73\x65 \x75\x70\x64\x61\x74\x65 \x45\x64\x69\x74\x48\x54\x4d\x4c \x61\x70\x70\x2e');
            return false;
        } */

        var now=performance.now();
        var int2=typeof _tap1TS=='undefined'?0:now-_tap1TS;
        var int3=typeof _tap2TS=='undefined'?0:now-_tap2TS;
        var int4=typeof _tap3TS=='undefined'?0:now-_tap3TS;
        var now=performance.now();
        _tap3TS=_tap2TS;
        _tap2TS=_tap1TS;
        _tap1TS=now;

        
        if(int4 && int4<sel.options.quadrupleTapInterval) {
            if(_debug) console.log('_detectMultipleTap 4');
            //_parentElement.style.webkitUserSelect = 'none';

            _hideMagnifier();
            _cancelCaretDelayed();
            sel.selectParagraph(e);
            if(sel.options.scrollOnTapSelect) _scrollRngDelayed(_range);
            return true;
        } else if(int3 && int3<sel.options.trippleTapInterval) {
            if(_debug) console.log('_detectMultipleTap 3');
            //_parentElement.style.webkitUserSelect = 'none';
            _hideMagnifier();
            _cancelCaretDelayed();
            if(!sel.selectBracesFrag(e));
            if(sel.options.scrollOnTapSelect) _scrollRngDelayed(_range);
            return true;
        } else if(int2 && int2<sel.options.doubleTapInterval) {
            if(_debug) console.log('_detectMultipleTap 2');
            //_parentElement.style.webkitUserSelect = 'none';
            _hideMagnifier();
            _cancelCaretDelayed();
            if (_tapData.el && _tapData.el.nodeType == 3) {
                if(_debug) console.log('_detectMultipleTap 2.1', _tapData.el, _tapData.ind);
                sel.selectWord(e);
            } else if (_tapData.ind && _tapData.el.childNodes && _tapData.ind < _tapData.el.childNodes.length) {
                if(_debug) console.log('_detectMultipleTap 2.2');
                sel.selectNode(_tapData.el.childNodes[_tapData.ind]);
            } else {
                if(_debug) console.log('_detectMultipleTap 2.3');
                sel.selectNode(_iEl);
            }
            if (sel.options.scrollOnTapSelect) _scrollRngDelayed(_range);

            return true;
        } else {
            if(_debug) console.log('_detectMultipleTap 1');
            let setCaretOnElement = sel.startElement;
            let startOffset = sel.startIndex;
            //if (!sel.startElement) {
                if(_debug) console.log('_detectMultipleTap 1.1');

                let rangeFromPoint = _getRangeFromPoint(null, _iX, _iY)
                setCaretOnElement = rangeFromPoint.startContainer,
                startOffset = rangeFromPoint.startOffset;
            //}
            _tapData={el:setCaretOnElement, ind:startOffset};

            //set cursor within text
            setCursorWithinText(setCaretOnElement, startOffset);
        }

        function setCursorWithinText(setCaretOnElement, startOffset) {
            //if (_isiOS) {
                if (_debug) console.log('setCursorWithinText 2.5', setCaretOnElement, startOffset);                
                _parentElement.setAttribute('contenteditable', true);
                _clearSelection(true, true);

                //_clearSelection() removes cursor from text for some reason, so we need to resotre it using coord of latest touch
                var range = _getRangeFromPoint(_parentElement, _latestTouch.clientX, _latestTouch.clientY);
                if (_debug) console.log('setCursorWithinText 2.6', range.startContainer, range.startOffset, range.endContainer, range.endOffset);

                //03.24: if keyboard is not active on iOS, then we cannot set cursor with delay (namely we cannot call el.focus() with delay).
                //Delay is needed to detect multiple tap. So we cannot detect multiple tap when kb is NOT active on iOS.
                //And when keyboard is active - we can use regular setCaret without delay as setting cursor immediately doesn't impact 
                //on multiple tap detection when keyboard is active
                sel.setCaret(range.startContainer, range.startOffset);

                _parentElement.focus(); //for some reason we cannot place this line before setCaret() as cursor will be set wrongly then

                //if (sel.options.scrollOnCaret) _scrollRngDelayed(_range);
                _runCallback('caret');
            /* } else {
                clearTimeout(_multipleTapDetection);
                _multipleTapDetection = setTimeout(function () {
                    _parentElement.setAttribute('contenteditable', true);

                    sel.setCaretDelayed(sel.startElement, sel.startIndex);
                    //sel.showKeyboard(sel.startElement,sel.startIndex);
                    _showMovableCaret(e);
                    if (sel.options.scrollOnCaret) _scrollRngDelayed(_range);

                    _runCallback('caret');

                    _parentElement.focus();

                }, 300)
            } */
        }

        return false;
    }

    function logAroundRange(range) {
        const charsBefore = 10;
        const charsAfter = 10;
    
        // Get the start and end offsets
        const startOffset = range.startOffset;
        const endOffset = range.endOffset;
    
        // Get the text content of the parent node
        const parentNodeText = range.startContainer.textContent;
    
        // Calculate the start and end index for substring
        const startIndex = Math.max(0, startOffset - charsBefore);
        const endIndex = Math.min(parentNodeText.length, endOffset + charsAfter);
    
        // Extract the substring
        const substring = parentNodeText.substring(startIndex, endIndex);
    
        console.log('logAroundRange', substring);
    }

    var _pauseKeyboardInput=function() {

        document.addEventListener('keydown',_handlerPauseOnKeyDown);
        setTimeout(function() { document.removeEventListener('keydown',_handlerPauseOnKeyDown); },400);
    }
    var _removeSelected=function(skipEvents) {
        if(_debug) console.log('_removeSelected')
        _wrapSelection(_range,sel.options.tempDeleteNodeTag);
        _deleteRangeContents(_range);

        var selectedTextElems = document.getElementsByClassName(sel.options.tempDeleteNodeTag);
        var selectionTags = Array.prototype.slice.call(selectedTextElems);
        var i, selTag;
        for(i = 0; selTag = selectionTags[i]; i++) {
            selTag.parentNode.removeChild(selTag);
        }

        _clearSelectionTags(skipEvents);
        sel.isEmpty=true;
        sel.endElement=null;
        sel.endIndex=-1;

        _restoreCaret();
    }
    var _deleteRangeContents=function(range) {

        range.deleteContents();
        if(range.startContainer==range.endContainer) {
            el=range.startContainer;
            if(el.nodeType==3) el=el.parentNode;
            var i,node;
            for(i=0;i<el.childNodes.length;i++) {
                node=el.childNodes[i];
                if(node.nodeType!=3) return;
                if(!node.nodeValue.match(/^[\s\r\n]+$/)) return;
            }
            if(el.parentNode) el.parentNode.removeChild(el);
        }

    }

    // include pair punctuation to selection
    var _includePairPunctuation = function () {
        if(_range.startContainer == _range.endContainer) {
            var openingChars = ['{', '(', '[', '<', '"', '�', '�', '��'];
            var closingChars = ['}', ')', ']', '<', '"', '?', '!', '?!'];
            var charKey, charBeforeSeln, firstCharOfSel, charAfterSeln, lastCharOfSel,
                stringToSearch, dotIndex;
            charBeforeSeln = _range.startContainer.textContent.charAt(_range.startOffset - 1);
            charAfterSeln = _range.endContainer.textContent.charAt(_range.endOffset);
            firstCharOfSel = _range.startContainer.textContent.charAt(_range.startOffset);
            lastCharOfSel = _range.startContainer.textContent.charAt(_range.endOffset - 1);

            if (_currentTouch.trg == _leftCaret) {
                //when selection is modifying by left cursor
                stringToSearch = (_range.startContainer.textContent).slice(_range.startOffset, _range.endOffset);
                if ((dotIndex = stringToSearch.lastIndexOf('.')) != -1) stringToSearch = stringToSearch.slice(dotIndex, stringToSearch.length);

                //firs of all we are looking at the end for selection as it always static; if there is any non-word char, it will search this at the beginning
                //if the first char after selection's end was non-word closing char that supposed to have same opening char...
                if ((charKey = closingChars.indexOf(charAfterSeln)) != -1) {

                    if(openingChars[charKey] != closingChars[charKey]) {
                        //it will look for same opening char at the beginning of selection...
                        if (stringToSearch.indexOf(openingChars[charKey]) != -1) {
                            //and if opening char was found in selection, it will include closing one either
                            _range.setEnd(_range.endContainer, _range.endOffset + 1)
                        }
                    } else {
                        stringToSearch = stringToSearch.slice(0, stringToSearch.length-1);
                        if (stringToSearch.indexOf(openingChars[charKey]) != -1) {
                            _range.setEnd(_range.endContainer, _range.endOffset + 1)
                        }
                    }

                    //if the first char after selection's end is non-word closing char that supposed to have same opening char...
                } else if ((charKey = closingChars.indexOf(lastCharOfSel)) != -1) {

                    if(closingChars[charKey] != openingChars[charKey]) {
                        if (stringToSearch.indexOf(openingChars[charKey]) == -1) {
                            _range.setEnd(_range.endContainer, _range.endOffset - 1)
                        }
                    } else {
                        stringToSearch = stringToSearch.slice(0, stringToSearch.length-1);
                        if (stringToSearch.indexOf(openingChars[charKey]) == -1) {
                            _range.setEnd(_range.endContainer, _range.endOffset - 1)
                        }
                    }
                }
            } else {
                stringToSearch = (_range.endContainer.textContent).slice(_range.startOffset, _range.endOffset);
                if ((dotIndex = stringToSearch.indexOf('.')) != -1) stringToSearch = stringToSearch.slice(0, dotIndex);

                //chech if there are any opening non-word char before selection to include if same closing will be found
                if ((charKey = openingChars.indexOf(charBeforeSeln)) != -1) {
                    if (stringToSearch.indexOf(closingChars[charKey]) != -1) {
                        _range.setStart(_range.startContainer, _range.startOffset - 1)
                    }
                    //chech if there are any opening non-word char in the beginning of selection to exclude it if no closing char
                } else if ((charKey = openingChars.indexOf(firstCharOfSel)) != -1) {
                    if(openingChars[charKey] != closingChars[charKey]) {
                        if (stringToSearch.indexOf(closingChars[charKey]) == -1) {
                            _range.setStart(_range.startContainer, _range.startOffset + 1)
                        }
                    } else {
                        stringToSearch = stringToSearch.slice(1, stringToSearch.length);
                        if (stringToSearch.indexOf(closingChars[charKey]) == -1) {
                            _range.setStart(_range.startContainer, _range.startOffset + 1)
                        }
                    }
                }
            }
        }
    }

    var _caretRangeFromPoint = function (elem, x, y) {
        if(_debug) console.log('_caretRangeFromPoint START', elem.nodeName, elem.textContent);
        if(elem.nodeType == elem.TEXT_NODE) {
            if(_debug) console.log('_caretRangeFromPoint 1', x, y);
            var range = elem.ownerDocument.createRange();
            range.selectNodeContents(elem);
            var currentPos = 0;
            var endPos = range.endOffset;
            while(currentPos+1 < endPos) {
                range.setStart(elem, currentPos);
                range.setEnd(elem, currentPos+1);
                let rangeRect;
                let rangeRects = range.getClientRects();
                if(_debug) console.log('_caretRangeFromPoint 1 rangeRects', rangeRects);

                for(let r = rangeRects.length - 1; r >= 0; r--) { //sometimes range may start from the end of previous line despite its content is on the next line
                    if(rangeRects[r].width !== 0) {
                        rangeRect = rangeRects[r];
                    }
                }
                if(_debug) console.log('_caretRangeFromPoint 1 rangeRect', rangeRect);

                if(rangeRect && rangeRect.left <= x && rangeRect.right  >= x &&
                    rangeRect.top  <= y && rangeRect.bottom >= y) {
                    return range;
                }
                currentPos += 1;
            }
        } else {
            if(_debug) console.log('_caretRangeFromPoint 2');
            for(var i = 0; i < elem.childNodes.length; i++) {
                var range = elem.childNodes[i].ownerDocument.createRange();
                range.selectNodeContents(elem.childNodes[i]);
                var rangeRect = range.getBoundingClientRect();
                if(rangeRect.left <= x && rangeRect.right  >= x &&
                    rangeRect.top  <= y && rangeRect.bottom >= y) {
                    if(_debug) console.log('_caretRangeFromPoint 2.1');
                    range.detach();
                    return(_caretRangeFromPoint(elem.childNodes[i], x, y));
                } else {
                    if(_debug) console.log('_caretRangeFromPoint 2.2');
                    range.detach();
                }
            }
        }
        return(null);
    }

    var _getRangeFromPoint = function (e, x,y) {
        if(_debug) console.log('_getRangeFromPoint START', x,y)
        var range
        if (typeof document.createRange != "undefined") {

            if (e != null && typeof e.rangeParent != "undefined") {
                if(_debug) console.log('_getRangeFromPoint 2.1')
                range = document.createRange();
                range.setStart(e.rangeParent, e.rangeOffset);
                range.collapse(true);
            } else if (document.caretPositionFromPoint) {
                if(_debug) console.log('_getRangeFromPoint 2.2')
                var pos = document.caretPositionFromPoint(x, y);
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
            } else if (document.caretRangeFromPoint) {
                if(_debug) console.log('_getRangeFromPoint 2.3')
                range = window.document.caretRangeFromPoint(x, y);
            }

            /* if(range == null) {
                range = _caretRangeFromPoint(_iEl, x,y)
                if(_debug) console.log('_getRangeFromPoint 2.4')
            } */
        }

        return range;
    }

    function getTextNodesRecursive(element, textNodes = []) {
        for (let node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                textNodes.push(node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                getTextNodesRecursive(node, textNodes);
            }
        }
        return textNodes;
    }

    function findPreviousElement(element) {
        if (!element) {
            return null;
        }

        let previousSibling = element.previousSibling;

        while (!previousSibling && element.parentNode && previousSibling != _parentElement) {
            element = element.parentNode;
            previousSibling = element.previousSibling;
        }

        return previousSibling;
    }

    // Finds & saves range and start element

    var _setSelectionStartFromXY=function(x,y,skipClear,snapToWords,snapToParagraph,preserveRange, isSwappingCarets) {
        if(_debug) console.log('_setSelectionStartFromXY', x, y);
        if(_startSelected) return;

        _startSelected=true;

        if(_leftCaret) {
            _leftCaret.style.display='none';
            _rightCaret.style.display='none';
        }

        _startX=_currentTouch.pageX != null ? _currentTouch.pageX : x;
        _startY=_currentTouch.pageY != null ? _currentTouch.pageY : y;
        _startT=_currentTouch.top;
        _startL=_currentTouch.left;

        //var range = document.caretRangeFromPoint(x, y);
        var range =_getRangeFromPoint(null, x, y)

        //var range = _caretRangeFromPoint(_iEl, x, y);
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        try {
            var startYcoords = range.getClientRects()[0];
            _startYtop = scrollTop + startYcoords.top;
            _startYbottom = scrollTop + startYcoords.bottom;
        } catch (e){}


        if(typeof snapToWords=='undefined') snapToWords=false;
        if(typeof snapToParagraph=='undefined') snapToParagraph=false;
        if(typeof skipClear=='undefined') skipClear=false;

        if(!skipClear) {
            if(_debug) console.log('_setSelectionStartFromXY !skipClear');

            if(_touchTS!=null && !sel.isEmpty) {
                if(_debug) console.log('_setSelectionStartFromXY !skipClear 1');
                _clearSelection(false, true);
            };

            var selectionTags=_getSelectionTags();
            if(selectionTags.length != 0) {
                if(_debug) console.log('_setSelectionStartFromXY !skipClear 2');
                _cleanTags(selectionTags);
            } else {
                _cleanTags([]);
            }

        }
        sel.range=null;

        var start;

        if (typeof document.caretRangeFromPoint != "undefined") {
            _start = document.caretRangeFromPoint(x, y);
            if(_debug) console.log('_setSelectionStartFromXY 2', _start.startContainer, _start.startOffset, _start.endContainer, _start.endOffset);

            //if(_isSelecting && _parentElement.getAttribute('contenteditable') == 'false' && sel.isEmpty){
            /* if(_isSelecting && sel.isEmpty){
                _start = _caretRangeFromPoint(_iEl, x, y);
                //_start = _getRangeFromPoint(null, x, y);
            } */

            if(_start && _start.startOffset>0) {
                if(_start.startContainer.nodeType==3) {
                    if(_start.startOffset+1>=_start.startContainer.length) {
                        if(_debug) console.log('_setSelectionStartFromXY 3');
                        //this is needed to fix webkit bug which returns in selecting
                        //whole paragraph when using caretRangeFromPoint on its top border
                        //return;
                        //TODO
                        //We can't return here - it breaks setCaret on last symbol of node
                        //Solve this situation
                    }
                }
            }

            if(_start==null) {
                if(_debug) console.log('_setSelectionStartFromXY 3.2');

                if(_iRange) _start=_iRange;
                else {
                    if(_leftCaret) {
                        _leftCaret.style.display='';
                        _rightCaret.style.display='';
                    }
                    return;
                }
            }

            if(_iEl && (!_start.startContainer || _start.startContainer.nodeType!=3)) {
                if(_debug) console.log('_setSelectionStartFromXY 4');
                _start=document.createRange();
                _start.setStart(_iEl,0);
            }
            if(_debug) console.log('_setSelectionStartFromXY 5', _start.startContainer, _start.startOffset, _start.endContainer, _start.endOffset);
            if(_debug) console.log('_setSelectionStartFromXY 5.1', _range.startContainer, _range.startOffset, _range.endContainer, _range.endOffset);

            let tryingTiSetStartAfterEnd = !isSwappingCarets && _range.endContainer && ((_start.startContainer === _range.endContainer && _start.startOffset > _range.endOffset) || _range.endContainer.compareDocumentPosition(_start.startContainer) === Node.DOCUMENT_POSITION_FOLLOWING);

            if(!preserveRange) {
                if(_debug) console.log('_setSelectionStartFromXY 6');

                _range = document.createRange();
                _range.setStart(_start.startContainer, _start.startOffset);
            } else {
                if (_debug) console.log('_setSelectionStartFromXY 7');

                if (!tryingTiSetStartAfterEnd) {
                    if (_debug) console.log('_setSelectionStartFromXY 7.1');
                    _range.setStart(_start.startContainer, _start.startOffset);
                } else {
                    let startContainer, startOffset;
                    if (_debug) console.log('_setSelectionStartFromXY 7.2', _range.endContainer.textContent, _range.endContainer.previousSibling);

                    let previousElement = findPreviousElement(_range.endContainer);
                    if(previousElement) {
                        let textNodes = getTextNodesRecursive(previousElement);                    
                        if (_debug) console.log('_setSelectionStartFromXY 7.2.1', textNodes);

                        if(textNodes.length) {
                            if (_debug) console.log('_setSelectionStartFromXY 7. textNodes', textNodes[textNodes.length - 1].textContent);
                        }
                        if(textNodes[textNodes.length - 1]) {

                            startContainer = textNodes[textNodes.length - 1];
                            startOffset = startContainer.textContent.length - 1;
                        } else {
                            startContainer = previousElement;
                            startOffset = 0;
                        }
                    } else {
                        if (_debug) console.log('_setSelectionStartFromXY 7.2.2');

                        startContainer = _range.endContainer;
                        startOffset = 0;
                    }

                    _range.setStart(startContainer, startOffset);
                }
            }
            
           
             
        }

        if(sel.options.matchPunctuationPairs && !snapToWords) _includePairPunctuation();

        if(_isSelecting && snapToWords && _startX != null && _startY != null) {
            if(_backward) {
                if(_debug) console.log('_setSelectionStartFromXY : snapToWords : _backward');
                var startIndex = _start.startOffset;
                var latestChars = (_range.startContainer.textContent).charAt(startIndex);
                if(latestChars != " ") {
                    var startContainerLength = _start.startContainer.textContent.length;
                    var offset, startOffset;
                    for(offset=startIndex; offset<(_range.startContainer.nodeValue).length; offset++){
                        var char = _range.startContainer.textContent.charAt(offset);

                        if(/[\W\s\n]+?/i.test(char) == true) {
                            _start.setStart(_start.startContainer, offset);
                            break;
                        }
                        if(offset == (_range.startContainer.nodeValue).length-1) {
                            _start.setStart(_start.startContainer, startContainerLength);
                            break;
                        }
                    }

                    _range.setStart(_start.startContainer, _start.startOffset);
                }
                var modifiedStartXYcoords = _range.getClientRects()[0];
                if(modifiedStartXYcoords != null) {
                    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                    _startX = modifiedStartXYcoords.left;
                    _startY = scrollTop + modifiedStartXYcoords.top;
                    _startYtop = scrollTop + modifiedStartXYcoords.top;
                    _startYbottom = scrollTop + modifiedStartXYcoords.bottom;
                }
            } else {

                if(_debug) console.log('_setSelectionStartFromXY : snapToWords : forward');
                var startIndex = _start.startOffset;
                var latestChars = (_range.startContainer.textContent).charAt(startIndex);
                if(latestChars != " ") {
                    var offset, startOffset;
                    for(offset=startIndex; offset!=0; offset--){
                        var char = _range.startContainer.textContent.charAt(offset);
                        if(/\s+?/i.test(char) == true) {
                            startOffset = offset+1;
                            break;
                        }
                    }
                    if(startOffset == null) startOffset = 0;

                    _start.setStart(_start.startContainer, startOffset);
                    _range.setStart(_start.startContainer, _start.startOffset);
                }

                var modifiedStartXYcoords = _range.getClientRects()[0];
                if(modifiedStartXYcoords != null) {
                    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                    _startX = modifiedStartXYcoords.left;
                    _startY = scrollTop + modifiedStartXYcoords.bottom;
                    _startYtop = scrollTop + modifiedStartXYcoords.top;
                    _startYbottom = scrollTop + modifiedStartXYcoords.bottom;
                }
            }

        }

        if(start!=null) _start=start;

        sel.startElement=_range.startContainer;
        sel.startIndex=_range.startOffset;
        sel.range=_range;
        if(_leftCaret) {
            _leftCaret.style.display='';
            _rightCaret.style.display='';
        }
    }

    var _setSelectionEndFromXY=function(x,y,snapToWords,snapToParagraph,preserveRange,noBackward) {
        if(_debug) console.log('_setSelectionEndFromXY', x, y, noBackward)
        if(_debug){
            try {
                var err = (new Error);
                console.log(err.stack);
            } catch (e) {

            }
        }
        if((!_isSelecting && _currentTouch && _currentTouch.isSelCaret == null) || (!_isSelecting && !_currentTouch)) return;

        if(_prev.selTimeout == null) {
            _prev.selTimeout = setTimeout(function () {
                _setSelectionEndFromXY(x, y, snapToWords, snapToParagraph, preserveRange, noBackward);
                clearTimeout(_prev.selTimeout);
                _prev.selTimeout = null;
            }, 0)

        } else if (_prev.selTimeout != null) return;

        var rangeRects = _range.getClientRects();

        var latestSelRect;
        var withinSelection;
        if (rangeRects) {
            var selRect, i;
            for (i = 0; selRect = rangeRects[i]; i++) {
                if (selRect.width == 0) continue;
                if (x >= selRect.left && x <= selRect.right && y >= selRect.top && y <= selRect.bottom) {
                    withinSelection = true;
                    if(selRect.width != 0) latestSelRect = selRect;
                }
            }
        }

        //to prevent redundant selection cycles when touch is still happening on selection tag$ allow selecting if it goes on not selected word
        /*if(snapToWords) {
            if (_backward) {
                if (x < _prev.prevSelX) {
                    if (withinSelection) return;
                } else if (x > _prev.prevSelX) {
                    if (!withinSelection) return;
                }
            } else {
                if (x > _prev.prevSelX) {
                    if (withinSelection) return;
                } else if (x < _prev.prevSelX) {
                    if (!withinSelection) return;
                }
            }
        }*/

        if(_leftCaret) {

            _leftCaret.style.display='none';
            _rightCaret.style.display='none';

        }

        if(typeof snapToWords=='undefined') snapToWords=false;
        if(typeof snapToParagraph=='undefined') snapToParagraph=false;

        if(typeof _startX!='undefined' && typeof _startY!='undefined') {

            _endX=x;
            _endY=y;
            _endT=window.pageYOffset || document.documentElement.scrollTop;
            _endL=window.pageXOffset || document.documentElement.scrollLeft;

            var selectionTags = _getSelectionTags();
            if(selectionTags.length != 0) {
                _cleanTags(selectionTags);
            }

            if(typeof document.caretRangeFromPoint != "undefined") var currentRange = document.caretRangeFromPoint(x, y);

            if(_debug) console.log('_setSelectionEndFromXY currentRange', currentRange);
            if(_debug) console.log('_setSelectionEndFromXY currentRange rect', currentRange.getBoundingClientRect(), currentRange.getClientRects()[0]);
            let currentPointRangeRect = currentRange ? currentRange.getClientRects()[0] : null;
            //let currentPointRangeRect = currentRange.getBoundingClientRect();
            
            var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            var curY = scrollTop+y;

            // the condition (currentPointRangeRect && currentPointRangeRect.top <= _startYbottom && x < _startX)  to hadnle cases when pointer is between lines but still not "(curY > _startYtop && curY < _startYbottom && x < _startX)""
            //it's about 0.5px that this condition is occuring
            if(_startYtop != null && _startYbottom != null) {
                _backward = (curY <= _startYtop) || (curY > _startYtop && curY < _startYbottom && x < _startX) || (currentPointRangeRect && currentPointRangeRect.top < _startYbottom && x < _startX);
                if(_debug) console.log('_setSelectionEndFromXY _backward 1', (curY <= _startYtop), (curY > _startYtop && curY < _startYbottom && x < _startX), (currentPointRangeRect && currentPointRangeRect.top < _startYbottom && x < _startX));
                if(_debug) console.log('_setSelectionEndFromXY _backward 1.1', curY, _startYbottom, currentPointRangeRect?.top, x < _startX);
                if(_debug) console.log('_setSelectionEndFromXY _backward value', _backward);
            } else {
                _backward = curY <= _startY-_lineOffset || ((curY > _startY-_lineOffset && curY < _startY+_lineOffset) && x < _startX);
                if(_debug) console.log('_setSelectionEndFromXY _backward 2', _backward);
            }

            if(noBackward) _backward = false;
            var start,end;

            /*if (typeof document.caretPositionFromPoint != "undefined") {
                if(_backward) {
                    _end = start = document.caretPositionFromPoint(x,y);
                    end = _start;
                } else {
                    start = _start;
                    _end = end = document.caretPositionFromPoint(x,y);
                }
                if(start==null||end==null) {
                    if(_leftCaret) {
                        _leftCaret.style.display='';
                        _rightCaret.style.display='';
                    }
                    return;
                }
                _range = document.createRange();
                _range.setStart(start.offsetNode,start.offset);
                _range.setEnd(end.offsetNode,end.offset);

            } else*/ 
            if (currentRange != null) {
                if(_backward) {
                    if(_debug) console.log('_setSelectionEndFromXY : _backward=true');
                    start = currentRange;
                    end = _start;
                } else {
                    if(_debug) console.log('_setSelectionEndFromXY : _backward=false');
                    start = _start;
                    try {
                        end = currentRange;
                    } catch (e) {}
                }

                if(start==null||end==null) {
                    if(_debug) console.log('_setSelectionEndFromXY : start==null||end==null');

                    if(_leftCaret) {
                        _leftCaret.style.display='';
                        _rightCaret.style.display='';
                    }
                    return;
                }

                if(!preserveRange) _range = document.createRange();

                _range.setStart(start.startContainer, start.startOffset);
                _range.setEnd(end.startContainer, end.startOffset);
                if(_debug) console.log('_setSelectionEndFromXY : _range 1', _range.endContainer, _range.endOffset);

            }

            if(_range.commonAncestorContainer==_parentElement.parentNode) {
                if(_debug) console.log('_setSelectionEndFromXY : commonAncestorContainer');

                _range.setStart(_parentElement.firstChild,0);
            }

            if(sel.options.matchPunctuationPairs && !snapToWords) _includePairPunctuation();

            var startContainer = _range.startContainer;
            var endContainer = _range.endContainer;

            if (_range.startContainer.nodeType!=3 && _range.startContainer.nodeName=='IMG') {
                startContainer = _range.startContainer;

                while(startContainer.nextSibling) {
                    startContainer=startContainer.nextSibling;
                    if(startContainer.tagName!='IMG')
                        break;
                    else
                        continue;
                }
            }

            /*if (startContainer.nodeType!=3){

                if(startContainer.contains(endContainer)) {
                    var i, keyNode;
                    for (i = 0; keyNode = startContainer.childNodes[i]; i++) {

                        if (keyNode.nodeType == 3) {
                            startContainer = keyNode;
                            break;
                        }
                    }

                    _range.setStart(startContainer, 0)

                } else {
                    if(!startContainer.nextSibling.contains(endContainer)) {
                        startContainer = startContainer.nextSibling;
                    }
                    var i, keyNode;
                    for (i = 0; keyNode = startContainer.childNodes[i]; i++) {

                        if (keyNode.nodeType == 3) {
                            startContainer = keyNode;
                            break;
                        }

                    }
                    _range.setStart(startContainer, 0)

                }
            }*/


            if (_range.endContainer.nodeType!=3 && _range.endContainer.nodeName=='IMG') {
                endContainer = _range.endContainer;

                while(endContainer.previousSibling) {
                    endContainer=endContainer.previousSibling;
                    if(endContainer.tagName!='IMG')
                        break;
                    else
                        continue;
                }


            }

            //BUG: if selection contains image, selection may be modified unwantedly
            if (endContainer.nodeType!=3){
                if(_debug) console.log('_setSelectionEndFromXY : endContainer.nodeType!=3');
                if(endContainer.contains(startContainer)) {
                    var i, keyNode;
                    for (i = 0; keyNode = endContainer.childNodes[i]; i++) {
                        if (keyNode.nodeType == 3) {
                            endContainer = keyNode;
                            break;
                        }
                    }
                    if(endContainer.nodeValue && endContainer.nodeValue.length) {
                        _range.setStart(endContainer, endContainer.nodeValue.length)
                    } else {
                        _range.setStartBefore(endContainer) //should debug
                    }
                } else {
                    if(_debug) console.log('_setSelectionEndFromXY : endContainer.nodeType!=3 endContainer', endContainer, endContainer.previousSibling);
                    if(endContainer.previousSibling) {
                        endContainer = endContainer.previousSibling;
                    }

                    if(endContainer.nodeName !== 'IMG') {
                        var i, keyNode;
                        for (i = 0; keyNode = endContainer.childNodes[i]; i++) {
    
                            if (keyNode.nodeType == 3) {
                                endContainer = keyNode;
                                break;
                            }
                        }
                    }

                    if(endContainer.nodeValue && endContainer.nodeValue.length) {
                        _range.setEnd(endContainer, endContainer.nodeValue.length)
                    } else {
                        _range.setEndAfter(endContainer) //should debug
                    }
                }
            }

            if(snapToWords) {
                //selection.modify is not used because it doesn't include non-word chars
                if(_backward) {
                    if (_debug) console.log('%c _setSelectionEndFromXY : snapToWords : backward', 'background: orange; color: #fff');
                    var startIndex = _range.startOffset;
                    var latestChars = (_range.startContainer.textContent).charAt(startIndex);

                    if(latestChars != " ") {
                        var offset, startOffset;
                        for(offset=startIndex; offset!=0; offset--){
                            var char = _range.startContainer.nodeValue.charAt(offset);

                            if(/\s+?/i.test(char) == true) {
                                startOffset = offset==0 ? offset : offset+1;
                                break;
                            }
                        }
                        if(startOffset == null) {
                            startOffset = 0;
                        }

                        _range.setStart(_range.startContainer, startOffset);
                    }

                } else {
                    if (_debug) console.log('%c _setSelectionEndFromXY : snapToWords : forward', 'background: orange; color: #fff');
                    var endIndex = _range.endOffset;
                    var latestChars = (_range.endContainer.textContent).charAt(endIndex);

                    if(latestChars != " ") {
                        if(x < _prev.prevSelX) {
                            var offset, endOffset;
                            for (offset = endIndex; offset != 0; offset--) {
                                var char = _range.endContainer.textContent.charAt(offset);

                                if (/\s+?/i.test(char) == true) {
                                    endOffset = offset;
                                    break;
                                }
                            }

                            //if it's one-word node and there is no space that preceed it
                            if (endOffset == null) {
                                endOffset = 0;
                            }

                            _range.setEnd(_range.endContainer, endOffset);
                        } else {

                            var offset, endOffset;
                            for (offset = endIndex; offset < (_range.endContainer.textContent).length; offset++) {
                                var char = _range.endContainer.textContent.charAt(offset);

                                if (/\s+?/i.test(char) == true) {
                                    endOffset = offset;
                                    break;
                                }
                            }
                            if (endOffset == null) {
                                endOffset = (_range.endContainer.textContent).length;
                            }

                            _range.setEnd(_range.endContainer, endOffset);
                        }
                    }
                }
            }

            if(snapToParagraph) {
                var winSel = window.getSelection();
                winSel.removeAllRanges();
                winSel.addRange(_range.cloneRange());
                winSel.modify('extend','left','paragraphboundary');
                winSel.modify('extend','right','paragraphboundary');
                var range=winSel.getRangeAt(0);
                var rects=range.getClientRects();
                if(rects.length) {
                    var first=rects[0],last=rects[rects.length-1];

                    var x1=first.left,y1=first.top,x2=last.left+last.width,y2=last.top+last.height;

                    //If the paragraph itself is big enough
                    if(_distance(x1,y1,x2,y2)>sel.options.paragraphThreshold) {

                        if(_backward) {
                            if(_distance(x1,y1,x,y)<sel.options.paragraphThreshold) {
                                _range.setStart(range.startContainer,range.startOffset);
                            }
                            if(_distance(x2,y2,_iX,_iY)<sel.options.paragraphThreshold) {
                                _range.setEnd(range.endContainer,range.endOffset);
                            }
                        } else {
                            if(_distance(x1,y1,_iX,_iY)<sel.options.paragraphThreshold) {
                                _range.setStart(range.startContainer,range.startOffset);
                            }
                            if(_distance(x2,y2,x,y)<sel.options.paragraphThreshold) {
                                _range.setEnd(range.endContainer,range.endOffset);
                            }
                        }


                    }
                }
                winSel.removeAllRanges();
            }
    
            _range=_fixRangeEnd(_range);

            if(_debug) console.log('_setSelectionEndFromXY : _range start 2', _range.startContainer.textContent, _range.startOffset);
            if(_debug) console.log('_setSelectionEndFromXY : _range end 2', _range.endContainer.textContent, _range.endOffset);

            //capture latest char to prevent selectionon same char
            var nodeValue = _range.endContainer.textContent;
            var char = nodeValue.charAt(_range.endOffset);
            _prev.prevSelChar = char;
            _prev.curSelRect = latestSelRect;

            _applySelection();

        }
        if(_leftCaret) {
            _leftCaret.style.display='';
            _rightCaret.style.display='';
        }
    }

    // Applies selection (draws span and sets external properties)
    var _applySelection=function() {
        if(_debug) console.log('_applySelection');
        _wrapSelection(_range,'SPAN',sel.options.className);

        sel.isEmpty=_range.startContainer==_range.endContainer && _range.startOffset==_range.endOffset;

        sel.startElement=_range.startContainer;
        sel.startIndex=_range.startOffset;
        sel.endElement=_range.endContainer;
        sel.endIndex=_range.endOffset;
        sel.range=_range;
    }

    var _wrapSelection=function(range,tagName,className,style) {
        if(_debug) console.log('_wrapSelection', range.startOffset, range.endOffset);
        
        var _nodes=_getRangeNodes(range.cloneRange());
       if(_debug) console.log('_wrapSelection: _nodes', _nodes);

        if(!_nodes) return false;
        var i,node;

        for(i=0;i<_nodes.length;i++) {
            node=_nodes[i];

            if(node.nodeType===3) {
                if(node.length==0) {
                    if(node.parentNode != null) node.parentNode.removeChild(node);
                    continue;
                }
                //TODO
                //check parent here
                //otherwise we can delete whitespace selections (normaly shouldn't)
                /* if(node.data.match(/^[\s\n\r]+$/)) { //commented 16.12.23
                    //node.parentNode.removeChild(node);
                    if(node.parentNode != null) node.parentNode.removeChild(node);
                    continue;
                } */
            }

            //if(node!==range.startContainer && node!==range.endContainer) {
            //check for types
            if(_tags[node.tagName]) {
                if(className) {
                    node.classList.add(className);
                    continue;
                }

            }
            //}

            //TODO
            //do something with container which ARE not in the middle, but take the whole
            //They are working now, but we can find a cleaner solution (like for middle elements)

            //NOTICE
            //This is important, we work ONLY with textNodes, and skip their parents
            //UPD: no longer true, as if we don't have className (e.g. when removing selection) we should use all nodes

            //if(node.nodeType!==3) continue;

            var el=document.createElement(tagName);
            if(style) {
                for (var j in style) {
                    el.style[j]=style[j];
                }
            }
            if(className) el.className=className;

            if(node.nodeType!==3) {
                if(_debug) console.log('_wrapSelection: node.nodeType!==3');

                if(className) continue;
                node.parentNode.insertBefore(el,node);
                el.appendChild(node);
                continue;
            }

            var rng=document.createRange();

            rng.selectNodeContents(node);

            if(node===range.startContainer) {
                if(_debug) console.log('_wrapSelection: range.startOffset', range.startOffset);
                
                rng.setStart(node,range.startOffset);
            }
            if(node===range.endContainer) {
                if(_debug) console.log('_wrapSelection: range.endOffset', range.endOffset);
                rng.setEnd(node,range.endOffset);
            }

            if(rng.startOffset===rng.endOffset){
                continue;
            }
            if(_debug) console.log('_wrapSelection: rng', rng);
            if(_debug) console.log('_wrapSelection: rng string', rng.toString());

            rng.surroundContents(el);

            if(node===range.endContainer || node.contains(range.endContainer)) {

                var cur=el,next=null;
                while(!next) {
                    next=cur.nextSibling;
                    cur=cur.parentNode;
                }
                if(next) range.setEnd(next,0); else {
                    throw new Error('Can\' find next node');
                }
            }

            if(_start) {

                // when surroundContents wrapps _range  in selection tags, endpoints of _start range (initialy
                // defined in _setSelectionStartFromXY) are being changed to wrong, so we need following code to fix it.
                // As selection tag (when selecting is backward) was created in the place of _start range, we need change
                // coords of _start range to begin it after creeated selection tag and before next (not selected node).
                // if there is no next node (usually when it is end of document after selection), zero-width space is
                // being created after selection tag end and before document end, so _start can be related to that node.
                if(_backward && (node===_start.startContainer || node.contains(_start.startContainer))) {
                    if(_debug) console.log('_wrapSelection: _start');

                    var cur=el,next=null;
                    while(!next) {
                        next=cur.nextSibling;
                        if(next && next.nodeType == 3 && next.nodeValue.trim() == '') {
                            if(cur.nextSibling != null) cur=cur.nextSibling;
                            next = null;
                            continue;
                        }

                        if(cur.parentNode != null && cur.parentNode != _parentElement.parentNode) {
                            cur = cur.parentNode;
                        } else {
                            if(cur == _parentElement) next = _parentElement;
                            break;
                        }


                    }

                    if(next) {
                        if(next == _parentElement) {
                            var lastNode = document.createTextNode('\u200B');
                            _parentElement.appendChild(lastNode);

                            _start.setStart(lastNode, lastNode.nodeValue.length);
                        } else _start.setStart(next,0);
                        _start.collapse(true);
                    } else {
                        throw new Error('Can\' find next node');
                    }
                }
            }

            //normalize SHOULD remove empty nodes, but in some WebKits it doesn't
            //so let's do it manually

            _removeEmptyNodes(_parentElement)
            _parentElement.normalize()
        }
    }

    var _getRangeNodes=function(range) {
        range=_fixRangeEnd(range);
        if(!range||range.startContainer==null||range.endContainer==null||range.commonAncestorContainer==null) return false;
        var nodes=[];
        var node=range.startContainer;

        while(node && node!=range.endContainer) {
            if(node.nodeType===3 || node.tagName=='IMG' || node.tagName=='BR' || node.tagName=='HR')
                nodes.push(node);
            else {
                if(node.childNodes.length != 0) {
                    node=node.childNodes[0];
                    continue;
                }
            }
            node=_getNextNode(node,_parentElement);

        }
        node=range.endContainer;

        while(node) {
            if(node.nodeType===3 || node.tagName=='IMG')
                nodes.push(node);
            else {
                if(node.childNodes.length != 0) {
                    node=node.childNodes[0];
                    continue;
                } else {
                    node=null
                }
            }
            break;
        }

        return nodes;
    }
    var _getNextNode=function(node, anchestor) {
        //if(_debug) console.log('_getNextNode START', node)

        while(node) {
            //if(_debug) console.log('_getNextNode WHILE', node.nextSibling, node.parentNode)
            if(node.nextSibling) return node.nextSibling;
            node=node.parentNode;
            if(anchestor) {
                if(!anchestor.contains(node) || anchestor===node) return null;
            }
        }
        return null;
    }

    var _getPrevNode=function(node, anchestor) {
        if(_debug) console.log('_getNextNode START', node)

        while(node) {
            if(_debug) console.log('_getNextNode WHILE', node.previousSibling , node.parentNode)
            if(node.previousSibling ) return node.previousSibling ;
            node=node.parentNode;
            if(anchestor) {
                if(!anchestor.contains(node) || anchestor===node) return null;
            }
        }
        return null;
    }

    var _shrinkRangeBoundsIn=function (range) {

        range = _fixRangeStart(range);
        if(_debug) console.log('sel.foreColor final range-s2', range.startContainer, range.startOffset, range.endContainer, range.endOffset);

        range = _fixRangeEnd(range);
        if(_debug) console.log('sel.foreColor final range-s3', range.startContainer, range.startOffset, range.endContainer, range.endOffset);

        return range;
    }

    var _fixRangeEnd=function(range) {
        if(range.endContainer.nodeType!=3 && range.endContainer.childNodes.length>=range.endOffset) {
            if(_debug) console.log('_fixRangeEnd');
            range=range.cloneRange();

            var end=range.endContainer.childNodes[range.endOffset-1];
            var id=0;
            if(end) {
                if(end.nodeType===3) {
                    id=end.length;
                } else {
                    id=end.childNodes.length;
                }
                range.setEnd(end,id);
                range=_fixRangeEnd(range);
            }
        }

        return range;
    }

    var _fixRangeStart=function(range) {
      //if(_debug) console.log('_fixRangeStart START', range.startContainer.nodeType, range.startContainer.childNodes.length);
        if(range.startContainer.nodeType!=3 && range.startContainer.childNodes.length != 0) {
            range=range.cloneRange();

            var start=range.startContainer.childNodes[range.startOffset];
            if(start) {
                if(start.nodeType===3) {
                    id=start.length;
                } else {
                    id=start.childNodes.length;
                }
                range.setStart(start,0);
                range=_fixRangeStart(range);
            }
        }

        return range;

        if(shouldFix) {
            if(sc.nodeType!=3) {
                var node=sc.childNodes[_range.startOffset];
                while(node.nodeType!=3 && node.childNodes.length) {
                    node=node.childNodes[0];
                }
                sc = node;

                _start.setStart(sc, _backward ? sc.textContent.length : 0)
            }


        }
    }

    var _expandRangeBoundsOut=function (range) {
        if(_debug) console.log('_expandRangeBoundsOut START')

        range = _fixRangeStartToMostParent(range)

        /* if(range.startContainer.nodeType == 1 && range.startOffset == 0) {
            while(range.startContainer.nodeType == 3) {
                if(range.startContainer != _parentElement) {
                    console.log('_expandRangeBoundsOut 1', range.startContainer)
                    let nextStartContaine = range.startContainer;
                   
                    console.log('_expandRangeBoundsOut 1.2',nextStartContaine)

                    range.setStartBefore(range.startContainer);

                    if(range.startContainer.nodeType == 1 && range.startContainer.classList.contains(sel.options.className)) {
                        nextStartContaine = _getPrevNode(range.startContainer, _parentElement);
                        console.log('_expandRangeBoundsOut 1.1',nextStartContaine)
                        range.setStartBefore(range.startContainer);
                    }
                    console.log('_expandRangeBoundsOut 1.2',range.startContainer)

                } else {
                    console.log('_expandRangeBoundsOut 2')
                    break;
                }
            }
        } */

        range = _fixRangeEndToMostParent(range);
        /* if(range.endContainer.nodeType == 1 && range.endOffset == 1 && range.endContainer.childNodes.length == 1) {
            while(range.endContainer.nodeType == 1 && range.endOffset == 1 && range.endContainer.childNodes.length == 1) {
                if(range.endContainer != _parentElement) {
                    range.setEndAfter(range.endContainer);
                } else {
                    break;
                }
            }
        } */
        return range;
    }

    var _fixRangeStartToMostParent=function(range) {
        range = range.cloneRange();
        if(range.startContainer.nodeType === 3 && range.startOffset == 0) {
            let currentNode = range.startContainer;
            if(currentNode.parentElement && currentNode.parentElement.childNodes[0] == currentNode) {
                while(currentNode.parentElement && currentNode.parentElement.childNodes[0] == currentNode && currentNode.parentElement != _parentElement) {
                    currentNode = currentNode.parentElement;
                }
                range.setStart(currentNode, 0);
            }
        }
        return range;
    }

    var _fixRangeEndToMostParent=function(range) {
       if(_debug) console.log('_fixRangeEndToMostParent START', range.endOffset);
        range = range.cloneRange();
        if(range.endContainer.nodeType === 3 && range.endOffset == range.endContainer.nodeValue.length) {
            let currentNode = range.endContainer;
           if(_debug) console.log('_fixRangeEndToMostParent 1', currentNode.parentElement.childNodes[currentNode.parentElement.childNodes.length - 1]);

            if(currentNode.parentElement && currentNode.parentElement.childNodes[currentNode.parentElement.childNodes.length - 1] == currentNode) {
               if(_debug) console.log('_fixRangeEndToMostParent 2');
                while(currentNode.parentElement && currentNode.parentElement.childNodes[currentNode.parentElement.childNodes.length - 1] == currentNode && currentNode.parentElement != _parentElement) {
                   if(_debug) console.log('_fixRangeEndToMostParent WHILE', currentNode);
                    currentNode = currentNode.parentElement;
                }
               if(_debug) console.log('_fixRangeEndToMostParent RESULT', currentNode);
                range.setEnd(currentNode, currentNode.childNodes.length);
            }
        }
        return range;
    }

    // Draw selection ends (carets)
    var _drawEnds = function(range) {
        if(_debug) console.log('_drawEnds');
        var rects=range.getClientRects();
        if(_debug) console.log('_drawEnds rects', rects, range.startContainer, range.endContainer);

        if(rects.length==0 || (rects.length==1 && rects[0].width==0)) {
            if(_leftCaret && _leftCaret.parentNode) _leftCaret.parentNode.removeChild(_leftCaret);
            if(_rightCaret && _leftCaret.parentNode) _leftCaret.parentNode.removeChild(_leftCaret);
            return;
        }

        var start,end;
        var i;
        for(i=0;i<rects.length-1;i++) {
            if(rects[i].width!=0) {
                start=rects[i];
                break;
            }
        }

        for(i=rects.length-1;i>=0;i--) {
            if(rects[i].width!=0) {
                end=rects[i];
                break;
            }
        }
        if(start==null||end==null) {
            if(_leftCaret && _leftCaret.parentNode) _leftCaret.parentNode.removeChild(_leftCaret);
            if(_rightCaret && _leftCaret.parentNode) _leftCaret.parentNode.removeChild(_leftCaret);
            return;
        }

        var wT=window.pageYOffset || document.documentElement.scrollTop;
        var wL=window.pageXOffset || document.documentElement.scrollLeft;
        if(_top!=document.body) {
            var oft=_offset(_top);
            wT+=_top.scrollTop-oft.top;
            wL+=_top.scrollLeft-oft.left;
        }


        if(_leftCaret==null) {
            _leftCaret=document.createElement('DIV');
            _leftCaret.classList.add(sel.options.caretLClassName);
            _leftCaret.addEventListener('touchstart',_selHandlerOnTouchStart, {  });
            _leftCaret.addEventListener('touchend',_selHandlerOnTouchEnd, {  });
            _leftCaret.addEventListener('touchmove',_selHandlerOnTouchMove, {  });
        }
        _leftCaret.style.display='';
        _top.appendChild(_leftCaret);


        if(_rightCaret==null) {
            _rightCaret=document.createElement('DIV');
            _rightCaret.classList.add(sel.options.caretRClassName);
            _rightCaret.addEventListener('touchstart',_selHandlerOnTouchStart, {  });
            _rightCaret.addEventListener('touchend',_selHandlerOnTouchEnd, {  });
            _rightCaret.addEventListener('touchmove',_selHandlerOnTouchMove, {  });
        }
        _rightCaret.style.display='';
        _top.appendChild(_rightCaret);

        _leftCaret.style.height=start.height+5+'px';
        _leftCaret.style.top=wT+start.top-5+'px';
        _leftCaret.style.left=wL+start.left-1+'px';

        _lcX=start.left; //wL+start.left
        _lcY=start.top; //wT+start.top
        _lcH=start.height;
        if(_debug) console.log('_drawEnds range', range.toString());

        _rightCaret.style.height=end.height+5+'px';
        _rightCaret.style.top=wT+end.top+'px';
        _rightCaret.style.left=wL+end.left-1+end.width+'px';

        _rcX=end.left + end.width; //wL+end.left + end.width;
        _rcY=end.top; //wT+end.top;
        _rcH=end.height;

        //!!!!!!!!!!

        // This is needed to save new limits after snap to words has been applied
        // If we need to call this function during selection touchmove - we should move this out to touchend callback
        if(sel.options.snapToWords) {
            if(_backward) {
                _endX=start.left;
                _endY=start.top+_lineOffset/2;
            } else {
                _endX=end.left+end.width;
                _endY=end.top+end.height-_lineOffset/2;
            }

        }
    }

    var _clearSelection=function(skipEvents,skipSelection) {
        if(_debug) console.log('_clearSelection')
        _clearSelectionTags(skipEvents);

        if(skipSelection!==true) {
            if (typeof window.getSelection!='undefined') {
                if (typeof window.getSelection().empty!='undefined') {
                    window.getSelection().empty();
                } else if (typeof window.getSelection().removeAllRanges!='undefined') {
                    window.getSelection().removeAllRanges();
                }
            } else if (typeof document.selection!='undefined') {
                document.selection.empty();
            }
        }
        sel.startIndex=-1;
        sel.endIndex=-1;
        sel.startElement=null;
        sel.endElement=null;
        sel.isEmpty=true;
        sel.range=null;
        //_hideMagnifier();
        if(skipEvents!==true) _runCallback('blur');
    }
    var _clearSelectionTags=function(skipEvents) {
        if(_debug) console.log('_clearSelectionTags', _leftCaret, _rightCaret);
        var selectionTags=_getSelectionTags();
        if(selectionTags.length != 0) {
            _cleanTags(selectionTags);
        }

        if(_leftCaret) {
            if(_leftCaret.parentNode) _leftCaret.parentNode.removeChild(_leftCaret);
        }
        if(_rightCaret) {
            if(_rightCaret.parentNode) _rightCaret.parentNode.removeChild(_rightCaret);
        }

        if(skipEvents!==true) _runCallback('selectionClear');
    }

    // Clear selection spans and optionally remove empty textNodes/unite splitted textNodes
    var _cleanTags=function(selectionTags,shouldNormalize) {
        if(_debug) console.log('_cleanTags')
        var par=selectionTags.map(function (singleSelTag) {
            return singleSelTag.parentNode;
        });

        var shouldFix=false;
        var shouldFixEc=false;

        var sc, ec;

        if(_start) {
            sc=_start.startContainer;
            ec=_range.endContainer;

            var i, parentOfSelTag;
            for(i=0; parentOfSelTag=par[i]; i++) {
                if(parentOfSelTag==sc) {
                    shouldFix=true;
                }
                if(parentOfSelTag==sc || parentOfSelTag==sc.parentNode) {
                    shouldFixEc=true;
                }
            }
        }

        var i, singleSelTag;
        for(i=0; singleSelTag=selectionTags[i]; i++) {
            if(singleSelTag.tagName=='IMG') {
                singleSelTag.classList.remove(sel.options.className);
                continue;
            }
            var parent = singleSelTag.parentNode;
            if(parent != null) {
                while (singleSelTag.firstChild) {
                    if(_debug) console.log('cleanTags singleSelTag.firstChild', singleSelTag.firstChild.nodeName);
                    parent.insertBefore(singleSelTag.firstChild, singleSelTag);
                }

                if(singleSelTag.parentNode) parent.removeChild(singleSelTag);
            }
        }


        /* var i, singleSelTag;
        for(i=0; singleSelTag=selectionTags[i]; i++) {
            if(singleSelTag.tagName=='IMG') {
                singleSelTag.classList.remove(sel.options.className);
                return;
            }
            if(singleSelTag.innerHTML.length) return;
            if(singleSelTag.parentNode) singleSelTag.parentNode.removeChild(singleSelTag);
        } */

        if(shouldNormalize || typeof shouldNormalize=='undefined' ) {

            var i, singleSelTag;
            for(i=0; singleSelTag=par[i]; i++) {
                singleSelTag.normalize();
            }
        }

        if(shouldFixEc && ec.lastChild != null) {
            if(ec.nodeType!=3) {
                /* var node=ec;
                 while(node.nodeType!=3 && node.childNodes.length) {
                     node=node.childNodes[0];
                 }*/
                _range.setEnd(ec.lastChild,ec.lastChild.length);
            }
        }

        if(shouldFix) {
            if(sc.nodeType!=3) {
                var node=sc.childNodes[_range.startOffset];
                while(node && node.nodeType!=3 && node.childNodes.length) {
                    node=node.childNodes[0];
                }
                if(node) {
                    sc = node;
                    _start.setStart(sc, _backward ? sc.textContent.length : 0)
                }
            }


        }
    }

    var _getSelectionTags=function(){
        var selectionTagsList=document.querySelectorAll('.'+sel.options.className);
        var selectionTags=Array.prototype.slice.call(selectionTagsList);
        return selectionTags;
    }

    var _removeEmptyNodes=function(elem) {
        var iterator = document.createNodeIterator(
            elem,
            NodeFilter.SHOW_ALL,
            {
                acceptNode: function (node) {
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        var node;

        while (iterator.nextNode()) {
            node=iterator.referenceNode;
            if(node.nodeType===3 && node.length===0) {
                if(node.parentNode) node.parentNode.removeChild(node);
            }
        }
    }

    window.removeEmptyNodes = _removeEmptyNodes;

    // Blur _parentElement (and don't trigger focusout)
    var _blurParent=function() {
        if(_debug) console.log('_blurParent');

        if(document.querySelector('.editarea:focus') != null) {
            sel.isCallingBlur = true;
            _parentElement.blur();
            _parentElement.setAttribute('contenteditable', false);
            setTimeout(function () {
                sel.isCallingBlur = null;
            }, 50);
        }
    }
    // Focus _parentElement
    var _focusParent=function() {
        if(_debug) console.log('_focusParent');
        _parentElement.focus();
    }

    // Blur document.activeElement (and don't trigger focusout)
    var _blurActive=function() {
        if(_debug) console.log('_blurActive');
        if(document.activeElement==_parentElement) return;
        sel.isCallingBlur=true;
        document.activeElement.blur();
        setTimeout(function() {sel.isCallingBlur=null;if(_debug){console.log('_blurActive : sel.isCallingBlur=null');}},50);
    }

    // Update bounds of element (to prevent selecting text outside)
    var _setLimits=function() {
        var obj=_parentElement;
        var offset=_offset(obj);
        var dL=window.pageXOffset || document.documentElement.scrollLeft,dT=- window.pageYOffset || document.documentElement.scrollTop;

        _minX=offset.left + dL;
        _minY=offset.top + dT;
        _maxX=offset.left + dL + obj.offsetWidth;
        _maxY=offset.top + dT +obj.offsetHeight;
    }

    _restoreScrollTop = function () {
        if(typeof Q != 'undefined' && Q.Cordova != null) {
            setTimeout(function () {
                window.scrollTo(0, sel.latestScrollTop);
            }, 50)
        } else {
            window.scrollTo(0, sel.latestScrollTop);
        }
    }

    function viewportHandler() {
        _visualViewportSize.width = visualViewport.width;
        _visualViewportSize.height = visualViewport.height;
    }

    window.visualViewport.addEventListener("resize", viewportHandler);

    // Detect window edges and do scrolling if needed
    var _checkScrolling=function(x,y) {
        if(_debug) console.log('_checkScrolling');
        var w=window.innerWidth?window.innerWidth:document.documentElement.clientWidth;
        var h=window.innerHeight?window.innerHeight:document.documentElement.clientHeight;

        if(_visualViewportSize.width) {
            w = _visualViewportSize.width;
            h = _visualViewportSize.height;
        }

        if(_topElementForScrollCheck != null) var baseElementRect = _topElementForScrollCheck.getBoundingClientRect();

        var dx=0,dy=0,s=sel.options.scrollSpeed;
        if(x<sel.options.scrollBorder.left) {
            dx=-s;
        } else if(x>w-sel.options.scrollBorder.right) {
            dx=s;
        }

        if(((baseElementRect && y<=baseElementRect.bottom+sel.options.scrollBorder.top) || (y<=sel.options.scrollBorder.top)) && y < _prev.prevClientY) {
            dy=-s;
        } else if(y>h-sel.options.scrollBorder.bottom) {
            dy=s;
        }

        if(dx||dy) _startScrolling(dx,dy); else _stopScrolling();
    }
    var _startScrolling=function(dx,dy) {
        if(_debug) console.log('_startScrolling');
        if(!_scroll) _scroll={};
        _scroll.dx=dx;
        _scroll.dy=dy;
        _scroll.ts=performance.now();
        window.requestAnimationFrame(_doScroll);
    }
    var _stopScrolling=function() {
        if(_debug) console.log('_stopScrolling');
        _scroll=false;
    }

    // Actually scroll window
    var _doScroll=function() {
        //if(_debug) console.log('_doScroll');
        if(!_scroll) return;

        var now=performance.now();
        var dt=now-_scroll.ts;
        var cf=dt*.1;
        if(_top != document.body) {
            _top.scrollBy(_scroll.dx*cf,_scroll.dy*cf);
        } else {
            window.scrollBy(_scroll.dx*cf,_scroll.dy*cf);
        }
        _scroll.ts=now;
        window.requestAnimationFrame(_doScroll);
    }

    var _scrollRngDelayed=function(range,time) {
        setTimeout(_scrollRangeToVisibleArea,time||400,range);
    }
    var _scrollRangeToVisibleArea=function(range) {
        if(_debug) console.log('_scrollRangeToVisibleArea');

        if(!range) return;
        range=range.cloneRange();

        var rects=range.getClientRects();
        if(!rects.length) return;


        var rect=rects[0],wH=window.innerHeight;

        if(_topElementForScrollCheck == null) {
            var top = sel.options.scrollSelBorder.top;
        } else {
            var top = _topElementForScrollCheck.getBoundingClientRect().top;
        }
        var btm=sel.options.scrollSelBorder.bottom;

        if(top=='auto') top=wH/10;
        if(btm=='auto') btm=wH/1.9;

        var offsetTop=rect.top;
        var offsetBtm=wH - rect.bottom;

        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        if(offsetTop<top) {
            _scrollWindow(0,scrollTop + offsetTop - top);
        } else if(offsetBtm<btm) {
            _scrollWindow(0,scrollTop + btm - offsetBtm);
        }
    }
    var _scrollWindow=function(x,y) {
        _smoothScrollTo(y);
    }
    var _smoothScrollTo=function(scrollTargetY, speed, easing) {
        var scrollY = window.scrollY,
            scrollTargetY = scrollTargetY || 0,
            speed = speed || 600,
            easing = easing || 'easeOutSine',
            currentTime = 0;
        var time = Math.max(.1, Math.min(Math.abs(scrollY - scrollTargetY) / speed, .8));
        var PI_D2 = Math.PI / 2,
            easingEquations = {
                easeOutSine: function (pos) {
                    return Math.sin(pos * (Math.PI / 2));
                },
                easeInOutSine: function (pos) {
                    return (-0.5 * (Math.cos(Math.PI * pos) - 1));
                },
                easeInOutQuint: function (pos) {
                    if ((pos /= 0.5) < 1) {
                        return 0.5 * Math.pow(pos, 5);
                    }
                    return 0.5 * (Math.pow((pos - 2), 5) + 2);
                }
            };
        function tick() {
            currentTime += 1 / 60;
            var p = currentTime / time;
            var t = easingEquations[easing](p);
            if (p < 1) {
                requestAnimationFrame(tick);
                window.scrollTo(0, scrollY + ((scrollTargetY - scrollY) * t));
            } else {
                window.scrollTo(0, scrollTargetY);
            }
        }
        tick();
    }

    // Save input content to history
    var _checkHasStateToSave=function(forceSave) {
        if(_debug) console.log('_checkHasStateToSave');
        if(_htmlBeforeInput) {
            if(!_history) _history=[];
            var w,wt,wl;
            w=window,wt=window.pageYOffset || document.documentElement.scrollTop,wl=w.pageXOffset || document.documentElement.scrollLeft;
            _history.push([_htmlBeforeInput,wl,wt]);
            _htmlBeforeInput=null;

        }
    }

    var _registerCallback=function(type,callback) {
        if(typeof _registeredCallbacks=='undefined') _registeredCallbacks={};
        if(typeof _registeredCallbacks[type]=='undefined') _registeredCallbacks[type]=[];
        _registeredCallbacks[type].push(callback);
    }
    var _runCallback=function(type,e) {
        if(typeof _registeredCallbacks=='undefined') return;
        if(typeof _registeredCallbacks[type]=='undefined') return;
        for(var i in _registeredCallbacks[type]) {
            var cb=_registeredCallbacks[type][i];
            if(typeof cb=='function') cb({target:sel,currentTarget:sel});
        }
    }

    var _disableUserSelectFix=function(mode) {
    return;
        if(sel.options.disableUserSelect) {
            _parentElement.style.setProperty('-webkit-user-select', (mode?'none':'auto'))
            _parentElement.style.setProperty('user-select', (mode?'none':'auto'))
        }
    }

    // Utility functions
    function _distance(x1,y1,x2,y2) {
        return Math.sqrt(Math.pow(x2-x1,2)+Math.pow(y2-y1,2));
    }

    var _insertAfter=function(elem, refElem) {
        var parent = refElem.parentNode;
        var next = refElem.nextSibling;
        if (next) {
            return parent.insertBefore(elem, next);
        } else {
            return parent.appendChild(elem);
        }
    }

    var _isFlowModelEl=function(element) {
        var tagName=element.tagName;
        switch(tagName) {
            case 'DIV':
            case 'SECTION':
            case 'ARTICLE':
            case 'TD':
            case 'TH':
                return true;
        }
        return false;
    }

    var _isInsideTag=function(node,tagName,param,value) {

        while(node!=_parentElement && node!=document && node) {
            if(node.tagName==tagName) {

                if(typeof param=='undefined') {
                    return node;
                }

                if(value && typeof value == 'object') {
                    var val=node.style[value.prop];

                    if(typeof value.value=='undefined') {
                        return {val:val};
                    }
                    if(val==value.value) return true;
                    return false;
                }

                var val=node.getAttribute(param);
                if(val) {
                    if(typeof value=='undefined') {
                        return {val:val};
                    }
                    if(val==value) return true;
                }

            }
            node=node.parentNode;
        }
        return false;
    }

    function _findElementsInRangeByTagName(range, tagName) {
        var commonAncestor = range.commonAncestorContainer;
    
        if(commonAncestor.tagName.toLowerCase() == tagName.toLowerCase()) {
            return [commonAncestor];
        }
        // Define a tree walker to traverse the DOM within the range
        var walker = document.createTreeWalker(commonAncestor, NodeFilter.SHOW_ELEMENT, {
            acceptNode: function(node) {
                console.log('node', node)
                if (node.tagName.toLowerCase() === tagName.toLowerCase()) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            }
        });
    
        var elements = [];
    
        // Traverse the DOM and collect elements within the range
        while (walker.nextNode()) {
            var node = walker.currentNode;
    
            // Check if the node is within the range
            if (range.intersectsNode(node)) {
                elements.push(node);
            }
        }
    
        return elements;
    }

    var _hexToRgb = function(hex) {
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? 'rgb('+parseInt(result[1], 16)+', '+parseInt(result[2], 16)+', '+parseInt(result[3], 16)+')': hex;
    }

    var _offset = function (el) {
        var rect = el.getBoundingClientRect(),
            scrollLeft = window.pageXOffset || document.documentElement.scrollLeft,
            scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        return { top: rect.top + scrollTop, left: rect.left + scrollLeft }
    }

    var _magnifierDiv,_magnifierSnapshot,_magnifierCanvas,_magnifierCtx;
    var _showMagnifier = function(touch,trg) {
        if(_debug) console.log('_showMagnifier')
        _magnifierShown=true;
        _magnifierLoaded=false;
        trg=trg||document.body;

        options=options||{};

        //snapshot is being taken on mutationobserver callback
        if(_lastMutation.snapshot != null) {
            _buildMagnifier(_lastMutation.snapshot, touch, trg);
        } else {
            var selections = document.getElementsByClassName(sel.options.className);
            var key, i;
            for(i = 0; key = selections[i]; i++) {
                key.classList.add(sel.options.className+'-hidden');
            }
            html2canvas(document.querySelector(".editarea"), {onclone: function(doc) {
                    var selections = doc.querySelectorAll('.' + sel.options.className);

                    var selectionTag, i;
                    for(i = 0; selectionTag = selections[i]; i++) {
                        selectionTag.style.setProperty('background-color', 'transparent', 'important');
                    }

                }}).then(function (canvas) {
                _lastMutation.snapshot = canvas;

            }).then(function (canvas) {
                _buildMagnifier(canvas, touch, trg);

            });
        }
    }

    var _buildMagnifier = function (canvas, touch, trg) {
        setTimeout(function() {

            _magnifierLoaded=true;

            var magnifierConDiv=document.getElementsByClassName(sel.options.magnifierClass)[0];
            magnifierConDiv.parentNode.removeChild(magnifierConDiv);

            var selectionTags=_getSelectionTags();
            var i, singleSelTag;
            for(i=0; singleSelTag=selectionTags[i]; i++){
                singleSelTag.classList.remove(sel.options.className+'-hidden');
            }

            if(!_magnifierShown) return;
            var ofst=_offset(_parentElement);

            var sT=window.pageYOffset || document.documentElement.scrollTop;
            var sL=window.pageXOffset || document.documentElement.scrollLeft;

            var left;
            var top;

            var size=100;

            var scale=canvas.width / _parentElement.offsetWidth;


            var div=document.createElement('DIV');
            div.style.left=sL+left+'px';
            div.style.top=sT+top+'px';
            div.style.zIndex='99999999';
            div.className=sel.options.magnifierClass;

            var canvas2=document.createElement('CANVAS');
            canvas2.width=size;
            canvas2.height=size;
            var ctx=canvas2.getContext('2d');

            div.appendChild(canvas2);
            document.body.appendChild(div);

            _magnifierDiv=div;
            _magnifierCtx=ctx;
            _magnifierCanvas=canvas2;
            _magnifierSnapshot=canvas;

            _redrawMagnifier(touch.clientX,touch.clientY,trg);
        }, 0);
    }

    var _redrawMagnifier=function(x,y,trg) {
        var range,rx,ry;
        if(!_magnifierShown) return;
        if(!_magnifierDiv) return;
        var left,top;
        var size=100;
        var zoomCF=sel.options.magnifyZoom;
        var scale=_magnifierSnapshot.width / _parentElement.offsetWidth;
        var ofst=_offset(_parentElement);


        rx=x;
        ry=y;

        left=x-size/2;
        top=y-size/2;

        _magnifierDiv.style.display='none';
        /*if(_leftCaret) {
            _leftCaret.style.display='none';
            _rightCaret.style.display='none';
        }
        _clearSelection();*/
        var wH=window.innerHeight-size/2;
        var wW=window.innerWidth-size/2;
        var sT=window.pageYOffset || document.documentElement.scrollTop;
        var sL=window.pageXOffset || document.documentElement.scrollLeft;
        if(left>(wW-size/2) && top<size/2){
            _magnifierDiv.style.left=(sL+left-size/2)+'px';
        } else if(left<size/2 && top<size/2){
            _magnifierDiv.style.left=(sL+left+size/2)+'px';
        } else if(left>size/2) {
            _magnifierDiv.style.left=(sL+left-size/2)+'px';
        } else {
            _magnifierDiv.style.left=(sL+left+size/2)+'px';
        }

        if(top<size/2 && left>(wW-size/2)){
            _magnifierDiv.style.top=(sT+(wH/2)-size/2)+'px';
        } else if(top<size/2 && left<size/2){
            _magnifierDiv.style.top=(sT+(wH/2)-size/2)+'px';
        } else if(top>size/2) {
            _magnifierDiv.style.top=(sT+top-size/2)+'px';
        } else {
            _magnifierDiv.style.top=(sT+top+size/2)+'px';
        }

        _magnifierCtx.clearRect(0,0,_magnifierCanvas.width,_magnifierCanvas.height);

        _magnifierCtx.beginPath();
        _magnifierCtx.fillStyle='#aaaaaa'
        _magnifierCtx.arc(size/2,size/2,size/2-2,0,Math.PI*2);
        _magnifierCtx.fill();


        var l,t,h;
        range=document.caretRangeFromPoint(x, y);
        if(range) {
            var rects=range.getClientRects();
            rect=rects[0];
            if(rects.length>1 && rect.width==0) rect=rects[1];

            if(rect) {
                l=sL + (typeof rect.x!='undefined'?rect.x:rect.left);
                t=sT + (typeof rect.y!='undefined'?rect.y:rect.top);
                h=rect.height;
            }
        }

        if(typeof l=='undefined') {

            var l,t,h;
            if(trg==_rightCaret) {
                l=_rcX;
                t=_rcY;
                h=_rcH;
            } else if (trg==_leftCaret){
                l=_lcX;
                t=_lcY;
                h=_lcH;
            } else if (trg.id==sel.options.caretDCId){
                var dragCaretRect = trg.getClientRects()[0];
                l=dragCaretRect.left;
                t=sT + dragCaretRect.top;
                h=dragCaretRect.height;
            }
        }

        try {
            var sw2,sh2;
            var sx=(sL-ofst.left + left +size/2*(1-1/zoomCF))*scale;
            var sy=(sT-ofst.top + top + size/2*(1-1/zoomCF))*scale
            var sw=size*scale/zoomCF;
            var sh=size*scale/zoomCF;
            var dx=0;
            var dy=0;
            var dw=size;
            var dh=size;
            if(sx<0) {
                dx=-sx/zoomCF;
                sx=0;
            } else if(sx+sw>_magnifierSnapshot.width) {
                sw2=Math.floor(_magnifierSnapshot.width-sx);
                dw=size*sw2/sw;
                sw=sw2;
            }
            if(sy<0) {
                dy=-sy/zoomCF;
                sy=0;
            } else if(sy+sh>_magnifierSnapshot.height) {
                sh2=Math.floor(_magnifierSnapshot.height-sy);
                dh=size*sh2/sh;
                sh=sh2;
            }

            _magnifierCtx.drawImage(_magnifierSnapshot,sx,sy,sw,sh,dx,dy,dw,dh);

            var uniqRangeRects = _uniqRangeRects();
            var iRect;
            if(uniqRangeRects){
                for(iRect in uniqRangeRects) {
                    var selRect = uniqRangeRects[iRect];
                    _magnifierCtx.beginPath();
                    _magnifierCtx.fillStyle='rgba(50, 200, 255, 0.3)';

                    _magnifierCtx.fillRect(
                        (selRect.left - (x-size/2/zoomCF) - 1)*zoomCF,
                        (selRect.top - (y-size/2/zoomCF))*zoomCF,
                        selRect.width*zoomCF, selRect.height*zoomCF);
                }
            }
        } catch(err) {

        }
        _magnifierCtx.save();


        _magnifierCtx.globalCompositeOperation='destination-in';
        _magnifierCtx.beginPath();
        _magnifierCtx.fillStyle='#000';
        _magnifierCtx.arc(size/2,size/2,size/2,0,Math.PI*2);
        _magnifierCtx.fill();
        _magnifierCtx.restore();


        _magnifierCtx.beginPath();
        _magnifierCtx.strokeStyle='rgba(204, 204, 204, 0.8)';
        _magnifierCtx.lineWidth=1;
        _magnifierCtx.arc(size/2,size/2,size/2-2,0,Math.PI*2);
        _magnifierCtx.stroke();

        _magnifierCtx.restore();
        _magnifierCtx.save();
        _magnifierCtx.arc(50,50,50,0,Math.PI*2);
        _magnifierCtx.closePath();
        _magnifierCtx.clip();
        _magnifierCtx.shadowColor='black'
        _magnifierCtx.shadowBlur=15;
        _magnifierCtx.stroke();
        _magnifierCtx.restore();


        _magnifierCtx.beginPath();
        _magnifierCtx.fillStyle='#3333FF';
        _magnifierCtx.fillRect(
            (l - (sL+x-size/2/zoomCF) - 1)*zoomCF,
            (t - (sT+y-size/2/zoomCF))*zoomCF,
            2*zoomCF, h*zoomCF);

        _magnifierDiv.style.display='';
        if(_leftCaret) {
            _leftCaret.style.display='';
            _rightCaret.style.display='';
        }
    }

    var _uniqRangeRects = function () {

        var rangeRects = _range.getClientRects();
        var sT = window.pageYOffset || document.documentElement.scrollTop;

        var uniqRects = [];
        var coords;
        var i;
        for (i in rangeRects) {
            if(rangeRects[i].width == 0) continue;
            coords = rangeRects[i]
            var key = String(sT  + rangeRects[i].top);
            if(uniqRects[key] != null) {
                if( rangeRects[i].width > uniqRects[key].width) uniqRects[key] = rangeRects[i];
            } else {
                if(rangeRects[i].width != null) {
                    uniqRects[key] = rangeRects[i];
                }

            }
        }

        if(!uniqRects) return false;

        return uniqRects;

    }

    var _takeSnapshot = function(){
       if(_debug) console.log('_takeSnapshot')
        if(_isSelecting || document.querySelector('.editarea:focus') != null) return;
        html2canvas(document.querySelector(".editarea"), {onclone: function(doc) {

                var selections = doc.querySelectorAll('.' + sel.options.className);

                var selectionTag, i;
                for(i = 0; selectionTag = selections[i]; i++) {
                    selectionTag.style.setProperty('background-color', 'transparent', 'important');
                }

            }}).then(function (canvas) {
            _lastMutation.snapshot = canvas;

        });
    }

    var _hideMagnifier=function() {
        _magnifierShown=false;
        _magnifierDiv=null;
        _magnifierSnapshot=null;
        _magnifierCanvas=null;
        _magnifierCtx=null;

        var magnifierConDiv = document.getElementsByClassName(sel.options.magnifierClass)[0];
        if(magnifierConDiv) {
            magnifierConDiv.parentNode.removeChild(magnifierConDiv);
        }
    }

    sel.init();

    return sel;
}