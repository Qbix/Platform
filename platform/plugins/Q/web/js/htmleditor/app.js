

(function app() {

    var mainView,
        mainViewContent,
        editorView,
        topBar,
        docsList,
        bottomBar,
        categories,
        currentEditor,
        _touch;

    var _debug = false;

    var options = {
        dialogueBgClass: 'App_HTMLeditor_dia_bg',
        dialogueConClass: 'App_HTMLeditor_dia_con',
        dialogueClass: 'App_HTMLeditor_dia',
        newDocDialogueClass: 'App_HTMLeditor_dia_doc',
        categoriesDialogueClass: 'App_HTMLeditor_dia_cat',
        promptDialogueClass: 'App_HTMLeditor_dia_prompt',

    }

    var _icons = {
        checkbox_checked:'<svg version="1.1" id="checkbox_checked" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="35px" height="35px" viewBox="0 0 35 35" enable-background="new 0 0 35 35" xml:space="preserve"><circle fill="none" stroke="#CCCCCC" stroke-width="2" stroke-miterlimit="10" cx="17.5" cy="17.5" r="16"/><image overflow="visible" width="32" height="32" xlink:href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACEAAAAhCAYAAABX5MJvAAAACXBIWXMAAAsSAAALEgHS3X78AAAA GXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAuBJREFUeNrMmO1PE0EQh3vXq7Tp CzWN1qoYIEQSEhO/+f9/9LMJCcagEaRC09AXKmCvd87iM2TctKXQi/SSXziuy/yenZ3dmxKkaZp7 7Cu6z+DdD98D+eEUIv3dXSlKUHrw8c1CMwwWyQTmeaDXRE9QAZgcxmPRb3QtikWTu2DmQmAeYlYS VUV1UY37Ip/lALgSDUUDUY/7Sz5LZsHMhAAgwsiZPhO10HNgymQkx+xHmJ+J2qgDlAOMp4FMhRAA nb0zaYheibZE26ININbJjtZVzKz7QByJDkVfRT9EXSDHApLMhTAALt0vMH6LtnimANNqQkF+AvAZ HfJs6INEMwqwjNmu6J1oD4AmS1NkXOjtjgT4GqB1VDG148YMxet29/hbNMSggakDeC/aAaBiZh/4 S8tzu4tKyNbNNRn75XbOPxBkocAsXpOFPQBekp3IpH/mjgMkIFbeAFwgBzAWz5sdYzORh9rtgk1T A00AClNmP++yxd00teIK9BwQV8xx6G3HKltw2wBU+Cx4wImscSvE2iR2C6/IeYdm8BpF1GIbahEW FliCRTJSo9g38KjjeQsRUjw1zgA9jIpLAvgFv27i1/AMfQiXoqcMLpoCW/YKTM2t41H1IewRXZ5y EOUyykZE7DJekV0OJS2gKMMs+NmIjE/eQjzqFZojd8JJNtY+gOdZXeoRG58bDwsR87od2R4gQ4jE vGlH+mq3EAnH6pDTrM+grLKhWdBT8xwv55n4EAN6gTOak6uMspEQq2/iD3yIlLdbj27INSSnDFx2 WbTPGNBPHOHRw/PvcvBej0lR23REp7z14gcui8a9INY3Yrfxiv23qK5Zh8ENju6SaXSiexxgWogj ANykDojdwWtit6hmQ9N2zB/si76ITswa3lWsWoRaYyfE2CfmsS7zrM5KC6gLue2ILhds7ybEGJgM OIBP3Hf9gl+JRnc1W/6V+fKzMl8DV+YL8f/618AfAQYAtnSGSDp+s08AAAAASUVORK5CYII=" transform="matrix(1 0 0 1 1.5 2.5)"></image><linearGradient id="SVGID_1_" gradientUnits="userSpaceOnUse" x1="4.5" y1="17.5" x2="30.5" y2="17.5"><stop  offset="0" style="stop-color:#4E5ADC"/><stop  offset="0.3719" style="stop-color:#3C5FDB"/><stop  offset="1" style="stop-color:#146ADA"/></linearGradient><circle fill="url(#SVGID_1_)" cx="17.5" cy="17.5" r="13"/><path fill="#FFFFFF" d="M23.828,11.561c0.082-0.082,0.182-0.123,0.299-0.123s0.217,0.041,0.299,0.123l0.984,1.002 \tc0.082,0.082,0.123,0.179,0.123,0.29s-0.041,0.208-0.123,0.29L14.881,23.689c-0.082,0.082-0.182,0.123-0.299,0.123 \ts-0.217-0.041-0.299-0.123L9.59,18.996c-0.082-0.082-0.123-0.182-0.123-0.299s0.041-0.217,0.123-0.299l0.984-0.984 \tc0.082-0.082,0.182-0.123,0.299-0.123s0.217,0.041,0.299,0.123l3.41,3.393L23.828,11.561z"/></svg>',
        checkbox_unchecked:'<svg version="1.1" id="checkbox_unchecked" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="35px" height="35px" viewBox="0 0 35 35" enable-background="new 0 0 35 35" xml:space="preserve"><circle fill="#FFFFFF" cx="17.5" cy="17.5" r="16"/><circle fill="none" stroke="#CCCCCC" stroke-width="2" stroke-miterlimit="10" cx="17.5" cy="17.5" r="16"/></svg>',
        checkmark_green:'<svg version="1.1" id="checkmark_green" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="43px" height="43px" viewBox="0 0 43 43" enable-background="new 0 0 43 43" xml:space="preserve"><linearGradient id="checkmark_gradient" gradientUnits="userSpaceOnUse" x1="1.5" y1="21.5" x2="41.5" y2="21.5"><stop  offset="0" style="stop-color:#B0BD08"/><stop  offset="1" style="stop-color:#88C906"/></linearGradient><circle fill="url(#checkmark_gradient)" cx="21.5" cy="21.5" r="20"/><circle fill="none" stroke="#A9BD08" stroke-width="2" stroke-miterlimit="10" cx="21.5" cy="21.5" r="20"/><path fill="#FFFFFF" d="M30.938,12.914c0.109-0.109,0.242-0.164,0.398-0.164s0.289,0.055,0.398,0.164l1.313,1.336 c0.109,0.109,0.164,0.238,0.164,0.387s-0.055,0.277-0.164,0.387L19.008,29.086c-0.109,0.109-0.242,0.164-0.398,0.164 s-0.289-0.055-0.398-0.164l-6.258-6.258c-0.109-0.109-0.164-0.242-0.164-0.398s0.055-0.289,0.164-0.398l1.313-1.313 c0.109-0.109,0.242-0.164,0.398-0.164s0.289,0.055,0.398,0.164l4.547,4.523L30.938,12.914z"/></svg>',
        checkmark:'<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"    width="17px" height="13px" viewBox="0 0 17 13" enable-background="new 0 0 17 13" xml:space="preserve">  <path fill="#FFFFFF" d="M14.828,0.436c0.082-0.082,0.182-0.123,0.299-0.123s0.217,0.041,0.299,0.123l0.984,1.002   c0.082,0.082,0.123,0.179,0.123,0.29s-0.041,0.208-0.123,0.29L5.881,12.564c-0.082,0.082-0.182,0.123-0.299,0.123   s-0.217-0.041-0.299-0.123L0.59,7.871C0.508,7.789,0.467,7.689,0.467,7.572S0.508,7.355,0.59,7.273l0.984-0.984   c0.082-0.082,0.182-0.123,0.299-0.123S2.09,6.207,2.172,6.289l3.41,3.393L14.828,0.436z"/>  </svg> ',
        folder:'<svg version="1.1" id="folder" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="25px" height="21px" viewBox="0 0 25 21" enable-background="new 0 0 25 21" xml:space="preserve"><path fill="#4E5ADC" d="M22.508,2.497c0.547,0,1.016,0.196,1.406,0.586C24.305,3.473,24.5,3.942,24.5,4.489v14.016 c0,0.547-0.195,1.016-0.586,1.406c-0.391,0.39-0.859,0.585-1.406,0.585H2.491c-0.547,0-1.016-0.195-1.406-0.585 C0.694,19.521,0.5,19.052,0.5,18.505V2.497c0-0.547,0.195-1.016,0.585-1.406C1.476,0.7,1.944,0.504,2.491,0.504h8.297 c0.141,0,0.269,0.023,0.387,0.07c0.117,0.047,0.222,0.117,0.316,0.211l1.711,1.711H22.508z M22.179,4.864 c0.516,0.25,0.954,0.578,1.313,0.985V4.489c0-0.266-0.098-0.496-0.293-0.691c-0.195-0.196-0.426-0.293-0.691-0.293h-9.305 c-0.125,0-0.25-0.027-0.375-0.083c-0.125-0.055-0.234-0.129-0.328-0.223l-1.71-1.711H2.491c-0.266,0-0.496,0.098-0.691,0.293 S1.507,2.215,1.507,2.497v3.352c0.359-0.406,0.797-0.734,1.313-0.984s1.078-0.375,1.688-0.375h15.985 C21.102,4.489,21.664,4.614,22.179,4.864z M22.508,18.506V8.497c0-0.547-0.195-1.016-0.586-1.407 c-0.391-0.391-0.867-0.585-1.43-0.585H4.507c-0.563,0-1.039,0.195-1.43,0.585C2.687,7.481,2.491,7.95,2.491,8.497v10.009H22.508z"/></svg>',
        folder_starred:'<svg version="1.1" id="folder_starred" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="25px" height="21px" viewBox="0 0 25 21" enable-background="new 0 0 25 21" xml:space="preserve"><path fill="#FFFFFF" d="M22.508,2.496c0.547,0,1.016,0.195,1.406,0.586S24.5,3.941,24.5,4.488v14.016 c0,0.547-0.195,1.016-0.586,1.406s-0.859,0.586-1.406,0.586H2.492c-0.547,0-1.016-0.195-1.406-0.586S0.5,19.051,0.5,18.504V2.496 c0-0.547,0.195-1.016,0.586-1.406s0.859-0.586,1.406-0.586h8.297c0.141,0,0.27,0.023,0.387,0.07s0.223,0.117,0.316,0.211 l1.711,1.711H22.508z M22.18,4.863c0.516,0.25,0.953,0.578,1.313,0.984V4.488c0-0.266-0.098-0.496-0.293-0.691 s-0.426-0.293-0.691-0.293h-9.305c-0.125,0-0.25-0.027-0.375-0.082S12.594,3.293,12.5,3.199l-1.711-1.711H2.492 c-0.266,0-0.496,0.098-0.691,0.293S1.508,2.215,1.508,2.496v3.352C1.867,5.441,2.305,5.113,2.82,4.863s1.078-0.375,1.688-0.375 h15.984C21.102,4.488,21.664,4.613,22.18,4.863z M22.508,18.504V8.496c0-0.547-0.195-1.016-0.586-1.406s-0.867-0.586-1.43-0.586 H4.508c-0.563,0-1.039,0.195-1.43,0.586S2.492,7.949,2.492,8.496v10.008H22.508z M17,10.488c0.109,0,0.207,0.035,0.293,0.105 s0.145,0.152,0.176,0.246c0.031,0.109,0.031,0.215,0,0.316s-0.094,0.184-0.188,0.246l-2.203,1.547l0.891,2.906 c0.031,0.094,0.031,0.195,0,0.305s-0.094,0.195-0.188,0.258c-0.047,0.031-0.094,0.051-0.141,0.059s-0.094,0.012-0.141,0.012 c-0.063,0-0.117-0.008-0.164-0.023s-0.094-0.039-0.141-0.07l-2.203-1.758l-2.18,1.758c-0.078,0.063-0.176,0.098-0.293,0.105 s-0.215-0.02-0.293-0.082c-0.094-0.063-0.16-0.148-0.199-0.258s-0.043-0.211-0.012-0.305l0.891-2.906l-2.203-1.547 c-0.078-0.063-0.137-0.145-0.176-0.246s-0.043-0.207-0.012-0.316c0.031-0.094,0.094-0.176,0.188-0.246s0.195-0.105,0.305-0.105 h2.648l0.867-2.18c0.047-0.094,0.113-0.168,0.199-0.223s0.176-0.082,0.27-0.082c0.109,0,0.207,0.027,0.293,0.082 s0.145,0.129,0.176,0.223l0.867,2.18H17z M14.211,12.34l1.195-0.844H14c-0.109,0-0.203-0.027-0.281-0.082s-0.141-0.129-0.188-0.223 l-0.539-1.359l-0.516,1.359c-0.047,0.094-0.113,0.168-0.199,0.223s-0.176,0.082-0.27,0.082h-1.43l1.219,0.844 c0.078,0.063,0.137,0.145,0.176,0.246s0.043,0.207,0.012,0.316l-0.539,1.688l1.242-0.984c0.047-0.031,0.098-0.059,0.152-0.082 s0.105-0.035,0.152-0.035c0.063,0,0.121,0.012,0.176,0.035s0.105,0.051,0.152,0.082l1.219,0.984l-0.516-1.688 c-0.031-0.109-0.031-0.215,0-0.316S14.117,12.402,14.211,12.34L14.211,12.34z"/></svg>',
        magnifying_glass:'<svg version="1.1" id="magnifying_glass" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="24px" height="24px" viewBox="0 0 24 24" enable-background="new 0 0 24 24" xml:space="preserve"><path fill="#FFFFFF" d="M23.836,21.984C23.945,22.094,24,22.227,24,22.383s-0.055,0.289-0.164,0.398l-1.055,1.055 C22.672,23.945,22.539,24,22.383,24s-0.289-0.055-0.398-0.164l-5.695-5.695c-0.047-0.047-0.086-0.105-0.117-0.176 s-0.047-0.145-0.047-0.223v-0.609c-0.859,0.734-1.832,1.313-2.918,1.734S10.969,19.5,9.75,19.5c-1.344,0-2.609-0.258-3.797-0.773 c-1.188-0.5-2.223-1.191-3.105-2.074s-1.574-1.918-2.074-3.105C0.258,12.359,0,11.094,0,9.75s0.258-2.609,0.773-3.797 c0.5-1.188,1.191-2.223,2.074-3.105s1.918-1.574,3.105-2.074C7.141,0.258,8.406,0,9.75,0s2.609,0.258,3.797,0.773 c1.188,0.5,2.223,1.191,3.105,2.074s1.574,1.918,2.074,3.105C19.242,7.141,19.5,8.406,19.5,9.75c0,1.219-0.211,2.371-0.633,3.457 s-1,2.059-1.734,2.918h0.609c0.078,0,0.152,0.016,0.223,0.047s0.129,0.07,0.176,0.117L23.836,21.984z M12.68,16.664 c0.906-0.391,1.699-0.926,2.379-1.605s1.215-1.473,1.605-2.379c0.391-0.922,0.586-1.898,0.586-2.93s-0.195-2.008-0.586-2.93 c-0.391-0.906-0.926-1.699-1.605-2.379s-1.473-1.215-2.379-1.605C11.758,2.445,10.781,2.25,9.75,2.25S7.742,2.445,6.82,2.836 C5.914,3.227,5.121,3.762,4.441,4.441S3.227,5.914,2.836,6.82C2.445,7.742,2.25,8.719,2.25,9.75s0.195,2.008,0.586,2.93 c0.391,0.906,0.926,1.699,1.605,2.379s1.473,1.215,2.379,1.605c0.922,0.391,1.898,0.586,2.93,0.586S11.758,17.055,12.68,16.664 L12.68,16.664z"/></svg>',
        close_circle:'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 100 100" enable-background="new 0 0 100 100" xml:space="preserve"><g><path fill="#000000" d="M81.457,19.156C73.15,10.85,62.106,6.275,50.359,6.275c-11.748,0-22.792,4.574-31.098,12.881   c-17.147,17.147-17.147,45.049,0,62.195c8.306,8.307,19.35,12.882,31.098,12.882c11.747,0,22.791-4.575,31.098-12.882   C98.604,64.205,98.604,36.304,81.457,19.156z M78.629,78.523c-7.551,7.551-17.591,11.71-28.27,11.71s-20.718-4.159-28.27-11.71   c-15.587-15.588-15.587-40.95,0-56.539c7.551-7.551,17.591-11.709,28.27-11.709s20.718,4.158,28.27,11.709   C94.216,37.573,94.216,62.936,78.629,78.523z"/><polygon fill="#000000" points="66.174,31.611 50.359,47.426 34.545,31.612 31.717,34.44 47.531,50.254 31.717,66.068    34.545,68.896 50.359,53.082 66.174,68.896 69.002,66.068 53.187,50.254 69.002,34.439  "/></g></svg>',
        trash_bin:'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" x="0px" y="0px" viewBox="0 0 100 100" style="enable-background:new 0 0 100 100;" xml:space="preserve"><path d="M83.3,14H61.7V9.9c0-2.7-2.2-4.9-4.9-4.9H43.2c-2.7,0-4.9,2.2-4.9,4.9V14H16.7c-2.2,0-3.9,1.8-3.9,3.9v7.8  c0,2.2,1.8,3.9,3.9,3.9h2v58.5c0,3.8,3,6.8,6.8,6.8h49.1c3.7,0,6.8-3.1,6.8-6.8V29.7h2c2.2,0,3.9-1.8,3.9-3.9V18  C87.2,15.8,85.4,14,83.3,14z M42.2,9.9c0-0.5,0.4-1,1-1h13.7c0.5,0,1,0.4,1,1V14H42.2V9.9z M77.4,88.2c0,1.6-1.3,2.9-2.9,2.9H25.5  c-1.6,0-2.9-1.3-2.9-2.9V29.7h54.8V88.2z M83.3,25.8H16.7V18h66.5V25.8z M33.4,83.3v-47c0-1.1,0.9-2,2-2c1.1,0,2,0.9,2,2v47  c0,1.1-0.9,2-2,2C34.2,85.2,33.4,84.3,33.4,83.3z M48,83.3v-47c0-1.1,0.9-2,2-2s2,0.9,2,2v47c0,1.1-0.9,2-2,2S48,84.3,48,83.3z   M62.7,83.3v-47c0-1.1,0.9-2,2-2c1.1,0,2,0.9,2,2v47c0,1.1-0.9,2-2,2C63.6,85.2,62.7,84.3,62.7,83.3z"/></svg>',
    }

    var _loader = {
        show: (function (html) {
            if(html) return '<div class="loader"><div class="loader-inner"><div class="box"></div><div class="box"></div></div></div>';

            var loaderCon = document.createElement('DIV');
            loaderCon.className = 'loader';
            var loader = document.createElement('DIV');
            loader.className = 'loader-inner';
            var box = document.createElement('DIV');
            box.className = 'box';
            loaderCon.appendChild(loader);
            loader.appendChild(box);
            loader.appendChild(box.cloneNode());
            return loaderCon;
        }),
        remove: (function (html) {
            var loader = document.getElementsByClassName('loader');

            for(var x in loader){
                loader[x].parentNode.removeChild(loader[x])
            }
        })
    }

    var init = function() {
        function createViews() {
            mainView = document.createElement('DIV');
            mainView.id = 'main';
            mainViewContent = document.createElement('DIV');
            mainViewContent.id = 'main-content';

            editorView = document.createElement('DIV')
            editorView.id = 'editor';


            header.createHeader();
            topBar.createTopBar();
            mainView.appendChild(mainViewContent);
            docsList = new docsList();
            docsList.createDocsList();


            bottomBar = new bottomBar()
            categories = new categories();
            bottomBar.createBottomBar();

            document.body.appendChild(mainView);
            document.body.appendChild(editorView);

        }

        createViews();
        views.setActiveView(mainView);

        window.onload = function () {
            if(location.href.indexOf('/deploy/screenshots/1') != -1) {
                docsList.loadItems()
            } else if(location.href.indexOf('/deploy/screenshots/2') != -1) {
                topBar.toggleSearchForm();
                search.doSearch('done', false);
                document.querySelector('input[name="search-keyword"]').value = 'done';
            } else if(location.href.indexOf('/deploy/screenshots/3') != -1) {
                currentEditor = new Editor();
                currentEditor.openDocument(1, function () {
                    window.editor.selector.selectNode(document.querySelector('.editarea').firstChild)
                    window.editor.updateButtonsOnSelection();
                });
            } else if(location.href.indexOf('/deploy/screenshots/4') != -1) {
                currentEditor = new Editor();
                currentEditor.openDocument(1, function () {
                    currentEditor.editarea.innerHTML = currentEditor.editarea.innerHTML.replace('http://site11.sg-dev-lab.com/htmleditor/', '');
                    window.editor.toggleHtmlMode();
                }, 400);
            } else if(location.href.indexOf('/deploy/screenshots/5') != -1) {
                docsList.loadItems()
                categories.dialogCategories();
            } else  docsList.loadItems()
        }



        document.addEventListener('touchstart', function (e) {
            touchEvent.capture(e);
        }, true);
        document.addEventListener('touchmove', function (e) {
            touchEvent.capture(e);
        }, true);
        document.addEventListener('touchend', function (e) {
            touchEvent.capture(e);
        }, true);
        document.addEventListener('deviceready', function () {
            StatusBar.backgroundColorByHexString('#4e5adc')
        });

        document.addEventListener("deviceready", function(){
            document.addEventListener("resume", function (e) {
                views.onResume(e)
            }, false);
        }, false);

        //iphone 5 fix
        window.scrollTo(0, 0)
    }


    var views = (function () {
        var _currentView = mainView;
        var _animationTimeout = null;

        function switchTo(viewEl, callbackBefore, callbackAfter) {
            if(_currentView == viewEl || _animationTimeout != null) return;
            if(typeof viewEl == 'string') viewEl = document.getElementById(viewEl);
            var viewName = viewEl.id;
            if(callbackBefore != null) callbackBefore();

            viewEl.style.transform = '';

            var preView = _currentView;
            if (viewName != 'main')
                viewEl.style.left = '0';
            else _currentView.style.left = '';

            //wait until animation will end
            _animationTimeout = setTimeout(function () {
                preView.style.transform = 'scale(0)';
                _currentView = viewEl;
                clearTimeout(_animationTimeout);
                _animationTimeout = null;

                callbackAfter();
            }, 300);

        }

        function setActiveView(viewEl) {
            _currentView = viewEl;
        }

        function getActiveView() {
           return _currentView;
        }

        function dialogIsOpened() {
            if(!document.body.classList.contains('modal-opened')) document.body.classList.add('modal-opened');
        }

        function dialogIsClosed() {
            if(document.body.classList.contains('modal-opened')) document.body.classList.remove('modal-opened');
        }

        function promptDialog(params, callback) {
            //self.closeAllDialogues();

            var bg=document.createElement('DIV');
            bg.className = options.dialogueBgClass;

            var dialogCon=document.createElement('DIV');
            dialogCon.className = options.dialogueConClass;
            dialogCon.addEventListener('touchend', function (e){
                e.stopPropagation();
                //if(e.currentTarget == e.target) self.closeAllDialogues();
            });

            var dialogue=document.createElement('DIV');
            dialogue.className = options.dialogueClass + ' ' + options.promptDialogueClass;

            var dialogTitle=document.createElement('H3');
            dialogTitle.innerHTML = params.title;
            dialogTitle.className = 'dialog-header';

            var dialogInner=document.createElement('DIV');
            dialogInner.className = 'dialog-inner';


            var close=document.createElement('div');
            close.className = 'close-dialog-sign';

            var warningSign=document.createElement('DIV');
            warningSign.className = 'warning-sign';
            warningSign.innerHTML = '!';

            var dialogText=document.createElement('DIV');
            dialogText.className = 'prompt-dialog-text';
            dialogText.innerHTML = params.text

            var btnsGroup=document.createElement('DIV');
            btnsGroup.className = 'dialog-btns-group'
            var confirmBtn=document.createElement('BUTTON');
            confirmBtn.type='submit';
            confirmBtn.className = 'button btn-blue';
            confirmBtn.innerHTML = 'Yes';

            var cancelBtn=document.createElement('BUTTON');
            cancelBtn.type='button';
            cancelBtn.className = 'button btn-gray';
            cancelBtn.innerHTML = 'No';

            close.addEventListener('click', closeAllDialogues);
            cancelBtn.addEventListener('click', closeAllDialogues);

            confirmBtn.addEventListener('click', callback);

            dialogInner.appendChild(dialogTitle);
            dialogInner.appendChild(warningSign);
            dialogInner.appendChild(dialogText);
            btnsGroup.appendChild(confirmBtn);
            btnsGroup.appendChild(cancelBtn);
            dialogInner.appendChild(btnsGroup);

            dialogue.appendChild(close);
            dialogue.appendChild(dialogInner);
            dialogCon.appendChild(dialogue)
            document.body.appendChild(dialogCon);
            document.body.appendChild(bg);


            views.dialogIsOpened();
        }

        function alertDialog(params, callback) {
            //self.closeAllDialogues();

            var bg=document.createElement('DIV');
            bg.className = options.dialogueBgClass;

            var dialogCon=document.createElement('DIV');
            dialogCon.className = options.dialogueConClass;
            dialogCon.addEventListener('touchend', function (e){
                e.stopPropagation();
                //if(e.currentTarget == e.target) self.closeAllDialogues();
            });

            var dialogue=document.createElement('DIV');
            dialogue.className = options.dialogueClass + ' ' + options.promptDialogueClass;

            var dialogTitle=document.createElement('H3');
            dialogTitle.innerHTML = params.title != null ? params.title : '';
            dialogTitle.className = 'dialog-header';

            var dialogInner=document.createElement('DIV');
            dialogInner.className = 'dialog-inner';


            var close=document.createElement('div');
            close.className = 'close-dialog-sign';

            var warningSign=document.createElement('DIV');
            warningSign.className = 'warning-sign';
            warningSign.innerHTML = '!';

            var dialogText=document.createElement('DIV');
            dialogText.className = 'prompt-dialog-text';
            dialogText.innerHTML = params.text != null ? params.text : '';

            var btnsGroup=document.createElement('DIV');
            btnsGroup.className = 'dialog-btns-group'
            var confirmBtn=document.createElement('BUTTON');
            confirmBtn.type='submit';
            confirmBtn.className = 'button btn-blue';
            confirmBtn.innerHTML = params.title != null ? params.title : 'Yes';

            var cancelBtn=document.createElement('BUTTON');
            cancelBtn.type='button';
            cancelBtn.className = 'button btn-gray';
            cancelBtn.innerHTML = 'Cancel';

            close.addEventListener('click', closeAllDialogues);
            cancelBtn.addEventListener('click', closeAllDialogues);

            confirmBtn.addEventListener('click', callback);

            dialogInner.appendChild(dialogTitle);
            dialogInner.appendChild(warningSign);
            dialogInner.appendChild(dialogText);
            btnsGroup.appendChild(confirmBtn);
            dialogInner.appendChild(btnsGroup);

            dialogue.appendChild(close);
            dialogue.appendChild(dialogInner);
            dialogCon.appendChild(dialogue)
            document.body.appendChild(dialogCon);
            document.body.appendChild(bg);


            views.dialogIsOpened();
        }

        function onResumeEventHandler() {
            if(Q.Cordova == null) return;

            Q.Cordova.info(function(info){
                var xhr = new XMLHttpRequest();
                xhr.open('GET', 'http://edithtml.app/pings?udid='+info['Q.udid']+'&time='+(new Date()));
                xhr.onload = function() {
                    if (xhr.status === 200) {
                        var response = JSON.parse(xhr.responseText);
                        if(response['alert'] != null) views.alertDialog(response['alert'], function () {
                            if(response['alert']['url']) {
                                var win=window.open(response['alert']['url'], '_blank');
                                win.focus();
                            }
                        })
                    }
                };
                xhr.send();
            })
        }

        return {
            switchTo: switchTo,
            setActiveView: setActiveView,
            getActiveView: getActiveView,
            dialogIsOpened: dialogIsOpened,
            dialogIsClosed: dialogIsClosed,
            promptDialog: promptDialog,
            alertDialog: alertDialog,
            onResume: onResumeEventHandler,
        }
    }())

    var Editor = (function() {
        this.documentName;
        this.documentId;
        this.html;
        this.htmlId;
        this.currentDocument;
        this.editarea;
        this.documentNameEl;
        this.createdEl;

        this.openDocument = function (docId, afterDocLoadedCallback) {
            editorView.innerHTML = '';
            currentEditor.createHeader();


            views.switchTo(editorView, null, function () {
                var editarea = document.createElement('DIV');
                editarea.className = 'editarea';
                editarea.innerHTML = '';
                editorView.appendChild(editarea)
                currentEditor.editarea = editarea;

                var el = new HTMLeditor(editarea, {});
                window.editor = el;
                editorDB('documents').get(docId, function (result) {
                    if(result) {
                        currentEditor.currentDocument = result;
                        currentEditor.documentId = docId;
                        currentEditor.documentNameEl.innerHTML = result.name;
                        currentEditor.createdEl.innerHTML = currentEditor.timeConverter(result.created);
                        editorDB('documents_html').get(docId, function (docHtml) {
                            currentEditor.editarea.innerHTML = docHtml.html;

                            currentEditor.htmlId = docHtml.objectId;

                            //wait animation to end
                            if(search.getQuery() && !search.titlesOnly()){
                                setTimeout(function () {
                                    window.editor.applyFunction('find');
                                    window.editor.runSearch(search.getQuery())
                                    if(afterDocLoadedCallback != null) afterDocLoadedCallback();
                                    return;
                                }, 350)
                            } else if(afterDocLoadedCallback != null) afterDocLoadedCallback();
                        })
                    }
                })
            });

            //currentEditor.editarea.innerHTML = _loader.show(true);
        }

        this.createHeader = function () {
            var header = document.createElement('DIV');
            header.id = 'editor-header';

            var editorHeaderInner = document.createElement('DIV');
            editorHeaderInner.id = 'editor-header-inner';
            var renameBtnCon = document.createElement('DIV');
            renameBtnCon.className = 'rename-input-con'
            var documentNameCon = document.createElement('DIV');
            documentNameCon.id = 'editor-docname';
            var documentName = document.createElement('SPAN');
            //documentName.innerHTML = this.documentName;
            var dateCreated = document.createElement('DIV');
            dateCreated.className = 'document-created-date'
            //dateCreated.innerHTML = this.timeConverter(currentEditor.currentDocument.created);

            var closeDocumentSign = document.createElement('DIV');
            closeDocumentSign.className = "close-sign";

            documentName.addEventListener('touchend', function () {
                documentName.contentEditable = true;
                documentName.style.whiteSpace = 'normal';
            })

            documentName.addEventListener('blur', function () {
                documentName.style.whiteSpace = '';

                currentEditor.currentDocument.name = documentName.textContent;
                documents.save(currentEditor.currentDocument, true);

                var docsListItem = docsList.docsListItems.filter(function(obj){
                    return obj.id == currentEditor.currentDocument.objectId
                })[0];
                docsListItem.setName(documentName.textContent);
            })

            documentName.addEventListener('keydown', function (e) {
                if(e.keyCode==13) {
                    e.preventDefault();
                }
            })

            documentName.addEventListener('keyup', function (e) {
                if(e.keyCode==13) {
                    documentName.contentEditable = false;
                    e.preventDefault();
                }
            })

            closeDocumentSign.addEventListener('touchend', function () {
                if( window.editor == null ) return;
                views.switchTo(mainView, function () {

                    if(window.editor == null) return;
                    editorDB('documents_html').save({
                        objectId: currentEditor.htmlId,
                        html: window.editor.getHtml(),
                        documentId: currentEditor.documentId
                    }, function (result) {
                        currentEditor.currentDocument.introText = window.editor.getText().substring(0, 100);
                        documents.save(currentEditor.currentDocument, true)

                        var docsListItem = docsList.docsListItems.filter(function(obj){
                            return obj.id == currentEditor.currentDocument.objectId
                        })[0];
                        docsListItem.setIntro(currentEditor.currentDocument.introText);

                        //editorView.innerHTML = '';
                        //docsList.loadItems();
                    })

                    // animation doesnt work with fixed elements, so we need set position to absolute;

                    var header = editorView.querySelector('#editor-header');
                    header.style.position = 'absolute';

                    var toolbar = editorView.querySelector('.Q_HTMLeditor_bar');
                    if(toolbar == null) return;
                    var toolbarRect = toolbar.getBoundingClientRect();
                    toolbar.style.position = 'absolute';
                    toolbar.style.top = toolbarRect.top + 'px';

                    window.editor.imageResizing.hideAllHandlers();
                }, function () {
                        window.editor.selector.clearSelection();
                        window.editor.destroy();
                        window.editor = null;
                        currentEditor = null;
                });



            })

            header.appendChild(editorHeaderInner);
            documentNameCon.appendChild(renameBtnCon);
            renameBtnCon.appendChild(documentName);
            //documentNameCon.appendChild(renameBtn);
            editorHeaderInner.appendChild(documentNameCon);
            documentNameCon.appendChild(dateCreated);
            editorHeaderInner.appendChild(closeDocumentSign);

            editorView.insertBefore(header, editorView.firstChild)

            this.createdEl = dateCreated;
            this.documentNameEl = documentName;
        }

        this.timeConverter = function(timestamp) {
            var date = new Date(timestamp);
            return [
                ("0" + (date.getMonth()+1)).slice(-2),
                ("0" + date.getDate()).slice(-2),
                date.getFullYear()
            ].join('/');
        }

    })

    var topBar = (function () {
        var _topBarEl;
        var _newDocumentBtn;
        var _searchForm;

        function createTopBar() {
            var topBar = document.createElement('DIV');
            topBar.id = 'top-bar';

            var createNewDocCon = document.createElement('SPAN');
            createNewDocCon.id = 'new-doc-btn';
            var createNewDocIcon = document.createElement('SPAN');
            createNewDocIcon.id = 'new-doc-btn-icon';
            createNewDocIcon.innerHTML = '+';
            var createNewDocText = document.createElement('SPAN');
            createNewDocText.id = 'new-doc-btn-text';
            createNewDocText.innerHTML = 'New HTML Document';

            createNewDocCon.addEventListener('touchend', documents.dialogCreateNew)

            topBar.appendChild(createNewDocCon);
            createNewDocCon.appendChild(createNewDocIcon);
            createNewDocCon.appendChild(createNewDocText);

            _newDocumentBtn = createNewDocCon;
            _topBarEl = topBar;

            mainViewContent.appendChild(topBar);
        }

        function toggleSearchForm(query) {
            if(_newDocumentBtn.classList.contains('hidden-view-el')) {
                _newDocumentBtn.classList.toggle('hidden-view-el');
                _searchForm.parentNode.removeChild(_searchForm);
                search.reset();
                header.hideCloseSign();
                return;
            }

            _newDocumentBtn.classList.add('hidden-view-el');

            var form=document.createElement('FORM');
            form.id = 'top-bar-search';

            var inputCon=document.createElement('DIV');
            inputCon.className = 'input-group';

            var documentName=document.createElement('INPUT');
            documentName.type = 'text';
            documentName.name = 'search-keyword';
            documentName.required = 'required';
            documentName.placeholder = 'Document name';
            documentName.value = query != null ? query : '';
            /*documentName.addEventListener('keyup', function (e) {
                if(e.target.value != "")
                    form.querySelector('button[type="submit"]').disabled = false;
                else
                    form.querySelector('button[type="submit"]').disabled = 'disabled';
            });*/

            var inputAddon = document.createElement('SPAN');
            inputAddon.classList.add('input-group-addon');
            var circle = document.createElement('SPAN');
            circle.className = 'clear-input-value';
            circle.innerHTML = _icons.close_circle
            circle.addEventListener('touchend', function () {
                documentName.value = '';
            });

            var submitBtn = document.createElement('BUTTON');
            submitBtn.type ='submit';
            //submitBtn.className = 'button btn-blue';
            submitBtn.innerHTML = _icons.magnifying_glass;

            var titlesOnlyLabel = document.createElement('LABEL');
            var titlesOnlyCheckmark = document.createElement('SPAN');
            titlesOnlyCheckmark.className = 'checkmark';
            var titlesOnly = document.createElement('INPUT');
            titlesOnly.type = 'checkbox';
            var titlesOnlyCaption = document.createElement('SPAN');
            titlesOnlyCaption.innerHTML = ' Search titles only';

            submitBtn.addEventListener('submit', function (e) {
                search.doSearch(documentName.value, titlesOnly.checked);
                documentName.blur();
                e.preventDefault();
            });

            form.addEventListener('submit', function (e) {
                search.doSearch(documentName.value, titlesOnly.checked);
                documentName.blur();
                e.preventDefault();
            });

            form.appendChild(inputCon);
            inputCon.appendChild(documentName);
            inputCon.appendChild(inputAddon);
            inputAddon.appendChild(circle);
            inputAddon.appendChild(submitBtn);
            titlesOnlyLabel.appendChild(titlesOnly);
            titlesOnlyLabel.appendChild(titlesOnlyCheckmark);
            titlesOnlyLabel.appendChild(titlesOnlyCaption);
            form.appendChild(titlesOnlyLabel)

            _topBarEl.appendChild(form);

            _searchForm = form;
            documentName.focus();

            header.closeTempMode(function () {
                topBar.toggleSearchForm();
                search.reset();
                docsList.loadItems();
            });
        }


        return {
            createTopBar: createTopBar,
            toggleSearchForm: toggleSearchForm,
        }
    }());

    var header = (function () {
        var _headerEl;
        var _controlNav;
        var _trashBin;
        var _closeTempModeEl; // e.g whe user wants close search results

        function createHeader() {
            var header = document.createElement('DIV');
            header.id = 'header';

            var headerInner = document.createElement('DIV');
            headerInner.id = 'header-inner';
            var logoCon = document.createElement('DIV');
            logoCon.id = 'logo-con';
            var logoImgCon = document.createElement('DIV');
            logoImgCon.id = 'logo-img-con'
            var logoImg = document.createElement('IMG');
            logoImg.src = 'edithtml.svg';
            var logoTitleCon = document.createElement('DIV');
            logoTitleCon.id = 'logo-title-con';
            var logoTitle = document.createElement('span');
            logoTitle.innerHTML = 'Edit HTML';

            var headerBar = document.createElement('DIV');
            headerBar.id = 'header-bar'
            var headerControlNav = document.createElement('DIV');
            headerControlNav.className = 'control-nav';

            var trashBin = document.createElement('DIV');
            trashBin.className = 'remove-docs hidden'
            trashBin.innerHTML = _icons.trash_bin;

            var closeTempMode = document.createElement('DIV');
            closeTempMode.className = 'close-mode-sign hidden';

            trashBin.addEventListener('touchend', function () {
                views.promptDialog({
                    title:'Delete document(s)',
                    text: 'Are you sure you want to delete selected document(s)?'
                }, function () {
                    docsList.removeSelected();
                    closeAllDialogues();
                });

            });

            header.appendChild(headerInner);
            headerInner.appendChild(logoCon);
            logoCon.appendChild(logoImgCon);
            logoImgCon.appendChild(logoImg);
            logoTitleCon.appendChild(logoTitle);
            logoCon.appendChild(logoTitleCon);

            headerInner.appendChild(headerBar);
            headerBar.appendChild(headerControlNav);
            headerControlNav.appendChild(trashBin);

            headerBar.appendChild(closeTempMode);

            mainView.appendChild(header);

            _headerEl = header;
            _controlNav = headerControlNav;
            _trashBin = trashBin;
            _closeTempModeEl = closeTempMode;
        }

        function controlNav() {
            return _controlNav;
        }

        function closeTempMode(callback) {
            _closeTempModeEl.innerHTML = '';
            var closeDocumentSign = document.createElement('DIV');
            closeDocumentSign.className = "close-sign";
            closeDocumentSign.addEventListener('touchend', function () {
                callback();
                closeDocumentSign.parentNode.removeChild(closeDocumentSign);
                _closeTempModeEl.classList.add('hidden');
            });
            _closeTempModeEl.appendChild(closeDocumentSign);
            _closeTempModeEl.classList.remove('hidden');
        }

        function hideCloseSign() {
            _closeTempModeEl.classList.add('hidden');
        }

        function showTrashBin() {
            _trashBin.classList.remove('hidden')
        }

        function hideTrashBin() {
            _trashBin.classList.add('hidden')
        }


        return {
            createHeader: createHeader,
            controlNav: controlNav,
            closeTempMode: closeTempMode,
            showTrashBin: showTrashBin,
            hideTrashBin: hideTrashBin,
            hideCloseSign: hideCloseSign
        }
    }());

    var docsList = (function() {
        this.docsListItems = [];
        this.docsListEl;
        this.currentCategory;

        this.createDocsList = function () {
            this.docsListEl = document.createElement('UL');
            this.docsListEl.id = 'docs-list';

            mainViewContent.appendChild(this.docsListEl);
        }

        this.loadItems = function(indexName, indexValue) {

            this.docsListEl.appendChild(_loader.show());
            editorDB('documents').getStorage((function (results) {

                docsList.empty();

                if(results.length == 0) {
                    docsList.updateUIonDocsListUpd();
                    return;
                }

                //sort alphabetically
                /*results.sort(function(a, b){
                    var x = a.name.toLowerCase();
                    var y = b.name.toLowerCase();
                    if (x < y) {return -1;}
                    if (x > y) {return 1;}
                    return 0;
                });*/
                //sort by date
                results.sort(function(a, b){
                    var x = a.created;
                    var y = b.created;
                    if (x < y) {return -1;}
                    if (x > y) {return 1;}
                    return 0;
                });

                for (var i in results) {
                    var documentObj = results[i];
                    docsList.addItem(documentObj)
                }

                docsList.updateUIonDocsListUpd();
            }), null, indexName, indexValue);
        };

        this.filterByCategory = function (category) {
            if(category.objectId == 'all') {
                docsList.loadItems()
                bottomBar.setCurrentCategory(category.name);
                this.currentCategory = category;
                return;
            } else if(category == false) return;

            docsList.loadItems('categoryId', category.objectId)
            bottomBar.setCurrentCategory(category.name);
            this.currentCategory = category;
        }

        this.addItem = function (documentObj) {
            //add textNodes
            var item = document.createElement('LI');
            item.className = 'docs-list-item';
            item.dataset.documentId = documentObj.objectId;

            var itemCheckboxCon = document.createElement('LABEL');
            itemCheckboxCon.className = 'docs-list-checkbox';
            var itemCheckbox = document.createElement('INPUT');
            itemCheckbox.type = 'checkbox';
            var itemCheckmark = document.createElement('SPAN');
            itemCheckmark.className = 'checkmark';

            var itemDescriptionCon = document.createElement('DIV');
            itemDescriptionCon.className = 'docs-item-description';
            var itemTitle = document.createElement('H3');
            itemTitle.className = 'docs-item-title';
            itemTitle.innerHTML = documentObj.name;

            var itemIntroText = document.createElement('P');
            itemIntroText.className = 'docs-item-intro';
            if(documentObj.introText != null && documentObj.introText.trim() != '')
                itemIntroText.innerHTML = documentObj.introText + '...'
            else itemIntroText.innerHTML = '<span class="item-no-content">no content</span>';

            itemCheckbox.addEventListener('change', function () {
                docsList.updateUIonDocsListUpd();
            })

            item.addEventListener('touchend', function (e) {
                if(e.target == itemCheckboxCon || e.target == itemCheckmark || !touchEvent.isTap()) return;
                currentEditor = new Editor();
                currentEditor.openDocument(documentObj.objectId);
            })

            item.appendChild(itemCheckboxCon);
            itemCheckboxCon.appendChild(itemCheckbox);
            itemCheckboxCon.appendChild(itemCheckmark);
            item.appendChild(itemDescriptionCon);
            itemDescriptionCon.appendChild(itemTitle);
            itemDescriptionCon.appendChild(itemIntroText);

            if(this.docsListEl.firstChild != null)
                this.docsListEl.insertBefore(item, this.docsListEl.firstChild);
            else this.docsListEl.appendChild(item);

            this.docsListItems.push({
                id: documentObj.objectId,
                name: documentObj.name,
                intro: documentObj.introText,
                category: documentObj.categoryId,
                created: documentObj.created,
                element: item,
                elements: {
                    checkbox: itemCheckbox,
                    name: itemTitle,
                    intro: itemIntroText,
                },
                setName: function (name) {
                    this.elements.name.innerHTML = name;
                },
                setIntro: function (text) {
                    if(text != null && text.trim() != '')
                        this.elements.intro.innerHTML = text + '...'
                    else this.elements.intro.innerHTML = '<span class="item-no-content">no content</span>';
                },
                select: function () {
                    this.elements.checkbox.checked = 'checked';
                },
                deselect: function () {
                    this.elements.checkbox.checked = false;
                },
                isSelected: function () {
                    return this.elements.checkbox.checked == true;
                },
                save: function () {
                    documents.save({
                        objectId: this.id,
                        name: this.name,
                        categoryId: this.categoryId,
                        intro: this.intro,
                        created: this.created,
                        updated: +new Date,
                    }, true)
                },
                remove: function () {
                    editorDB('documents').remove(this.id, null, null, (function () {

                        editorDB('documents_html').remove(null, 'documentId', this.id, (function () {

                            this.element.classList.add('hidden');
                            setTimeout((function () {
                                this.element.parentNode.removeChild(this.element);
                                docsList.docsListItems.splice(this.index(), 1);
                                docsList.updateUIonDocsListUpd();
                            }).bind(this), 500)

                        }).bind(this))

                    }).bind(this));
                },
                index: (function (){
                    return (docsList.docsListItems.map(function(x){
                        return x.id;
                    }).indexOf(this.id));
                }),
            })

            this.updateUIonDocsListUpd();
        }

        this.removeSelected = function () {
            var selectedDocuments = docsList.getSelectedItems();

            for(var x in selectedDocuments) {
                var item = selectedDocuments[x];
                item.remove();
            }

            docsList.updateUIonDocsListUpd();
        }

        this.toggleNoDocumentsNotice = function () {

            if(docsList.docsListItems.length != 0){
                var noticeEl = docsList.docsListEl.querySelector('.no-documents');
                if(noticeEl != null) noticeEl.parentNode.removeChild(noticeEl);

            } else {
                if(docsList.docsListEl.querySelector('.no-documents') == null && search.getQuery() != false)
                    docsList.docsListEl.innerHTML = '<div style="text-align: center" class="no-documents">No results for "' + search.getQuery() + '"</div>';
                else if(docsList.docsListEl.querySelector('.no-documents') == null)
                    docsList.docsListEl.innerHTML = '<div style="text-align: center" class="no-documents">No documents yet. Create some.</div>';
                window.scrollTo(0, 0);
            }
        }

        this.removeItem = function () {

        }

        this.updateUIonDocsListUpd = function () {


            var selectedItemsNum = 0;
            var listItem, i;
            for(i = 0; listItem = this.docsListItems[i]; i++) {
                if(listItem.isSelected()) selectedItemsNum++
            }

            docsList.toggleNoDocumentsNotice();
            if(this.docsListItems.length == 0) {
                header.hideTrashBin();
                bottomBar.hideClearButton();
                bottomBar.hideSelectAllButton();
                if(docsList.currentCategory != null)
                    bottomBar.setCurrentCategory(docsList.currentCategory.name);
                else bottomBar.setCurrentCategory('All categories');
            } else if(selectedItemsNum == this.docsListItems.length) {
                header.showTrashBin();
                bottomBar.hideSelectAllButton();
                bottomBar.showClearButton();
                bottomBar.setCurrentCategory('Set category');
            } else if(selectedItemsNum != 0) {
                header.showTrashBin();
                bottomBar.showClearButton();
                bottomBar.showSelectAllButton();
                bottomBar.setCurrentCategory('Set category');
            } else {
                header.hideTrashBin();
                bottomBar.hideClearButton();
                bottomBar.showSelectAllButton();
                bottomBar.setCurrentCategory(docsList.currentCategory != null ? docsList.currentCategory.name : 'All categories');
            }
        }

        this.getSelectedItems = function () {
            var selectedItems = [];
            var listItem, i;
            for(i = 0; listItem = this.docsListItems[i]; i++) {
                if(listItem.isSelected()) selectedItems.push(listItem)
            }
            return selectedItems;
        }

        this.selectAll = function () {
            var listItem, i;
            for(i = 0; listItem = this.docsListItems[i]; i++) {
                listItem.select()
            }

            this.updateUIonDocsListUpd();
        }

        this.clearAll = function () {
            var listItem, i;
            for(i = 0; listItem = this.docsListItems[i]; i++) {
                listItem.deselect()
            }
            this.updateUIonDocsListUpd();
        }

        this.empty = function () {
            this.docsListItems = []
            this.docsListEl.innerHTML = '';
            this.updateUIonDocsListUpd();
        }
    })

    var bottomBar = (function () {
        this.currentCategory;
        this.createBottomBar = function() {
            var bottomBarEl = document.createElement('DIV');
            bottomBarEl.id = 'bottom-bar';
            var innerBottomBar = document.createElement('DIV');
            innerBottomBar.id = 'inner-bottom-bar';

            var checkboxesMenu = document.createElement('DIV');
            checkboxesMenu.id = 'checkboxes-menu';
            checkboxesMenu.className = 'hidden';

            var selectAllItem = document.createElement('DIV');
            selectAllItem.id = 'check-all-btn';
            selectAllItem.className = 'hidden';
            var selectAllIcon = document.createElement('SPAN');
            selectAllIcon.innerHTML = _icons.checkmark;
            var selectAllLink = document.createElement('A');
            selectAllLink.innerHTML = 'All';

            var clearItem = document.createElement('DIV');
            clearItem.id = 'uncheck-all-btn';
            clearItem.className = 'hidden';
            var clearIcon = document.createElement('SPAN');
            clearIcon.innerHTML = '&#10005;';
            var clearLink = document.createElement('A');
            clearLink.innerHTML = 'Clear';


            var categoriesItem = document.createElement('DIV');
            categoriesItem.id = 'categories-menu';
            var categoriesIcon = document.createElement('SPAN');
            categoriesIcon.innerHTML = _icons.folder_starred;
            var categoriesLink = document.createElement('A');
            categoriesLink.innerHTML = 'All categoreis';


            var searchBox = document.createElement('DIV');
            searchBox.id = 'search-box';
            var searchIcon = document.createElement('SPAN');
            searchIcon.innerHTML = _icons.magnifying_glass;
            var searchIconText = document.createElement('SPAN');
            searchIconText.innerHTML = 'Search';

            selectAllItem.addEventListener('touchend', function () {
                docsList.selectAll();
            })

            clearItem.addEventListener('touchend', function () {
                docsList.clearAll()
            })

            categoriesItem.addEventListener('touchend', function () {
                categories.dialogCategories()
            })

            searchBox.addEventListener('touchend', function (e) {
                if(search.getQuery() !== false) docsList.loadItems();
                topBar.toggleSearchForm();
                //search.dialog();
                e.preventDefault();
            })

            bottomBarEl.appendChild(innerBottomBar);
            innerBottomBar.appendChild(checkboxesMenu);
            checkboxesMenu.appendChild(clearItem);
            clearItem.appendChild(clearIcon);
            clearItem.appendChild(clearLink);
            checkboxesMenu.appendChild(selectAllItem);
            selectAllItem.appendChild(selectAllIcon);
            selectAllItem.appendChild(selectAllLink);

            innerBottomBar.appendChild(categoriesItem);
            categoriesItem.appendChild(categoriesIcon);
            categoriesItem.appendChild(categoriesLink);

            innerBottomBar.appendChild(searchBox);
            searchBox.appendChild(searchIcon);
            searchBox.appendChild(searchIconText);

            mainView.appendChild(bottomBarEl);

            this.bottomBarEl = bottomBarEl;
            this.checkboxesMenu = checkboxesMenu;
            this.selectAllBtn = selectAllItem;
            this.clearBtn = clearItem;
            this.currentCategory = categoriesLink;
        }

        this.hideSelectAllButton = function () {
            if(!this.selectAllBtn.classList.contains('hidden')) this.selectAllBtn.classList.add('hidden');
            this.hideOrShowMenu();
        }

        this.showSelectAllButton = function () {
            this.selectAllBtn.classList.remove('hidden');
            this.hideOrShowMenu();
        }

        this.hideClearButton = function () {
            if(!this.clearBtn.classList.contains('hidden')) this.clearBtn.classList.add('hidden');
            this.hideOrShowMenu();
        }

        this.showClearButton = function () {
            this.clearBtn.classList.remove('hidden');
            this.hideOrShowMenu();
        }

        this.hideOrShowMenu = function () {
            if(this.clearBtn.classList.contains('hidden') && this.selectAllBtn.classList.contains('hidden'))
                this.checkboxesMenu.classList.add('hidden');
            else if(this.checkboxesMenu.classList.contains('hidden')) this.checkboxesMenu.classList.remove('hidden')

        }

        this.setCurrentCategory = function (categoryName) {
            this.currentCategory.innerHTML = categoryName;
        }

    })

    var documents = (function() {

        function save(record, descRiptionDataOnly) {

            editorDB('documents').save(record, function (result) {
                if(result) {
                    if(descRiptionDataOnly) return false;

                    editorDB('documents_html').save({
                        html: '',
                        documentId: result
                    }, function (result2) {
                        console.log('asdfsdaf 2');

                        record.objectId = result;

                        if (!result2)  return false;

                        if(docsList.docsListItems.length == 0) docsList.empty();
                        docsList.addItem(record);
                    })
                }
            })
        };

        function dialogCreateUpdate(doc) {

            var bg=document.createElement('DIV');
            bg.className = options.dialogueBgClass;

            var dialogCon=document.createElement('DIV');
            dialogCon.className = options.dialogueConClass;
            dialogCon.addEventListener('touchend', function (e){
                e.stopPropagation();
                //if(e.currentTarget == e.target) self.closeAllDialogues();
            });

            var dialogue=document.createElement('DIV');
            dialogue.className = options.dialogueClass + ' ' + options.newDocDialogueClass;

            var form=document.createElement('FORM');


            var close=document.createElement('div');
            close.className = 'close-dialog-sign';

            close.addEventListener('click', closeAllDialogues);

            var dialogTitle=document.createElement('H3');
            dialogTitle.innerHTML = 'Create new document';
            if(docsList.currentCategory != null && docsList.currentCategory.objectId != 'all')
                dialogTitle.innerHTML += ' in "' + docsList.currentCategory.name + '"';
            else if(docsList.currentCategory == null || docsList.currentCategory.objectId == 'all') dialogTitle.innerHTML += ' (uncategorized)';




            var inputCon=document.createElement('DIV');
            inputCon.className = 'input-group img-src';

            var documentId=document.createElement('INPUT');
            documentId.type='hidden';
            documentId.name='documentId';
            documentId.value = doc != null ? doc.id : null;

            var documentName=document.createElement('INPUT');
            documentName.type='text';
            documentName.name='name';
            documentName.required='required';
            documentName.placeholder='Document name';
            documentName.addEventListener('keyup', function (e) {
                if(e.target.value != "")
                    form.querySelector('button[type="submit"]').disabled = false;
                else
                    form.querySelector('button[type="submit"]').disabled = 'disabled';
            });


            var clearInputValue = document.createElement('SPAN');
            clearInputValue.classList.add('input-group-addon');
            var circle = document.createElement('SPAN')
            circle.className = 'clear-input-value';
            circle.innerHTML = _icons.close_circle;
            circle.addEventListener('touchend', function () {
                documentName.value = '';
            });

            if(!doc) clearInputValue.style.display = 'none';


            var submitBtn=document.createElement('BUTTON');
            submitBtn.type='submit';
            submitBtn.className = 'button btn-blue';
            submitBtn.disabled = doc ? false : 'disabled';
            submitBtn.innerHTML = 'Create';

            form.addEventListener('submit', function (e) {
                documents.submitDocument({
                    name: documentName.value,
                    id: doc != null ? doc.id : null,
                });
                e.preventDefault();
                closeAllDialogues();
            });

            form.appendChild(dialogTitle);
            form.appendChild(close);
            inputCon.appendChild(documentName);
            clearInputValue.appendChild(circle)
            inputCon.appendChild(clearInputValue);
            form.appendChild(inputCon);
            form.appendChild(submitBtn);

            dialogue.appendChild(form);
            dialogCon.appendChild(dialogue)
            document.body.appendChild(dialogCon);
            document.body.appendChild(bg);

            documentName.blur();

            views.dialogIsOpened();
        }

        function submitDocument(doc) {
            console.log('create', doc)
            if(doc == null) return;

            var docRecord = {};
            if(doc.id != null) {
                //docRecord = findDocumentById(_docs, doc.id);
            }

            docRecord.name = doc.name;
            docRecord.categoryId = docsList.currentCategory != null && docsList.currentCategory.objectId != 'all' ? docsList.currentCategory.objectId : 1;
            docRecord.created = +new Date;
            docRecord.updated = null;
            documents.save(docRecord)
        }

        function findDocumentById(array, value) {
            for (var i = 0; i < array.length; i++) {
                if (array[i].id === value) {
                    //documentEntity.call()
                    return array[i];
                }
            }
            return null;
        }

        return {
            dialogCreateNew:dialogCreateUpdate,
            submitDocument:submitDocument,
            save:save,
        }
    }());

    var categories = (function () {
        this.categoriesListEl;

        this.list = [];

        this.save = function(record) {
            editorDB('categories').save(record, function (result) {
                record.objectId = result;
                if(result) {
                    categories.list.push(record);
                    categories.addItemToList(record);
                }
            })
        };

        this.loadList= function () {
            this.list = [];
            editorDB('categories').getStorage((function (results) {
                //categories.list.concat(results);



                categories.list = results.slice(0);

                //sort alphabetically
                categories.list.sort(function(a, b){
                    var x = a.name.toLowerCase();
                    var y = b.name.toLowerCase();
                    if (x < y) {return -1;}
                    if (x > y) {return 1;}
                    return 0;
                });
                if(docsList.getSelectedItems().length == 0) categories.list.unshift({name:'All categories', objectId:'all'});
                if(results.length == 0) categories.save({name:'Uncategorized'})
                if(docsList.currentCategory == null && docsList.getSelectedItems().length == 0) docsList.currentCategory = categories.list[0];

                for (var i in categories.list) {
                    var categoryItem = categories.list[i];
                    categories.addItemToList(categoryItem)
                }

                if(docsList.getSelectedItems().length == 1) categories.selectCategoryById(docsList.getSelectedItems()[0].category)

                reposDialogs();
            }));
        }

        this.addItemToList = function (categoryObj) {
            //add textNodes
            var item = document.createElement('LI');
            item.className = 'category-list-item';
            item.dataset.id = categoryObj.objectId;

            var itemTitleCon = document.createElement('DIV');
            itemTitleCon.className = 'category-title-con';

            var itemTitleIcon = document.createElement('SPAN');
            itemTitleIcon.className = 'category-title-icon';
            itemTitleIcon.innerHTML = _icons.folder;



            var itemCheckbox = document.createElement('LABEL');
            itemCheckbox.className = 'category-list-checkbox category-title-con';

            var itemTitle = document.createElement('DIV');
            itemTitle.className = 'category-item-title';
            itemTitle.innerHTML = categoryObj.name;

            var checkboxInputCon = document.createElement('DIV');
            var itemCheckboxInput = document.createElement('INPUT');
            itemCheckboxInput.name = 'filter-by-category';
            itemCheckboxInput.type = 'radio';
            itemCheckboxInput.checked = (docsList.currentCategory != null && categoryObj.objectId == docsList.currentCategory.objectId) ? 'checked' : '';
            var itemCheckmark = document.createElement('SPAN');
            itemCheckmark.className = 'checkmark';

            item.appendChild(itemTitleIcon);
            item.appendChild(itemCheckbox);
            itemCheckbox.appendChild(itemTitle);
            itemCheckbox.appendChild(checkboxInputCon);
            checkboxInputCon.appendChild(itemCheckboxInput);
            checkboxInputCon.appendChild(itemCheckmark);

            this.categoriesListEl.appendChild(item);

            categoryObj.element = item;
            categoryObj.checkbox = itemCheckboxInput;
            categoryObj.select = function () {
                this.checkbox.checked = 'checked';
            }
            categoryObj.deselect = function () {
                this.checkbox.checked = false;
            };
            categoryObj.isSelected = function () {
                return this.checkbox.checked == true;
            };
        }

        this.dialogCategories = function() {
            this.areDocsSelected = docsList.getSelectedItems().length != 0 ? true : false;

            //self.closeAllDialogues();

            var bg=document.createElement('DIV');
            bg.className = options.dialogueBgClass;

            var dialogCon=document.createElement('DIV');
            dialogCon.className = options.dialogueConClass;
            dialogCon.addEventListener('touchend', function (e){
                e.stopPropagation();
                //if(e.currentTarget == e.target) self.closeAllDialogues();
            });

            var dialogue=document.createElement('DIV');
            dialogue.className = options.dialogueClass + ' ' + options.categoriesDialogueClass;

            var dialogTitle=document.createElement('H3');
            dialogTitle.innerHTML = this.areDocsSelected ? 'Set category' : 'Filter by category';
            dialogTitle.className = 'dialog-header';

            var form=document.createElement('FORM');
            form.className = 'dialog-inner';


            var close=document.createElement('div');
            close.className = 'close-dialog-sign checkmark';
            close.innerHTML = _icons.checkmark_green;

            var categoriesList = document.createElement('UL');
            categoriesList.className = 'categories-list';

            var inputCon=document.createElement('DIV');
            inputCon.className = 'input-group';

            var categoryNameCon = document.createElement('DIV');
            categoryNameCon.className = 'input-group-inner';
            var categoryName=document.createElement('INPUT');
            categoryName.type='text';
            categoryName.name='name';
            categoryName.required='required';
            categoryName.placeholder='Category name';

            var submitBtn=document.createElement('BUTTON');
            submitBtn.type='submit';
            submitBtn.className = 'button btn-blue';
            submitBtn.innerHTML = 'Create category';

            close.addEventListener('click', function (e) {
                var selectedCategory = categories.getSelectedCategory();
                if(docsList.getSelectedItems().length != 0 && selectedCategory != false){
                    categories.assignCategory(selectedCategory);
                } else categories.filterDocumentsByCategory()

                closeAllDialogues()
                e.preventDefault();
            });

            categoryName.addEventListener('keyup', function (e) {
                if(e.target.value != "") {
                    submitBtn.disabled = false;
                    categoryName.style.borderColor = '';
                } else
                    submitBtn.disabled = 'disabled';
            });

            form.addEventListener('submit', function (e) {
                e.preventDefault();

                if(categoryName.value.trim() == '') {
                    categoryName.style.borderColor = 'red';
                    return;
                }
                categories.submitCategory({
                    name: categoryName.value,
                });

                categoryName.value = '';
            });

            this.categoriesListEl = categoriesList;

            form.appendChild(dialogTitle);
            form.appendChild(categoriesList);
            inputCon.appendChild(categoryNameCon);
            categoryNameCon.appendChild(categoryName);
            form.appendChild(inputCon);
            form.appendChild(submitBtn);

            dialogue.appendChild(close);
            dialogue.appendChild(form);
            dialogCon.appendChild(dialogue)
            document.body.appendChild(dialogCon);
            document.body.appendChild(bg);

            categoryName.blur();

            views.dialogIsOpened();

            this.loadList();
        }

        this.getSelectedCategory = function () {
            for(var i in this.list) {
                if(this.list[i].isSelected()) return this.list[i];
            }

            return false;
        }

        this.selectCategoryById = function (id) {
            var category = categories.list.filter(function(obj){

                return obj.objectId == id;
            })[0];
            if(category != null) category.select();
        }

        this.submitCategory = function (categoryObj) {
            if(name == null) return;

            var categoryRecord = {};
            /*if(categoryRecord.id != null) {
                categoryRecord = findCategoryById(categoryRecord.id);
            }*/

            categoryRecord.name = categoryObj.name;
            this.save(categoryRecord)
        }

        this.assignCategory = function (categoryObj) {
            var selectedDocuments = docsList.getSelectedItems();
            var categoryRecord = {};
            if(categoryRecord.id != null) {
                //categoryRecord = findCategoryById(categoryRecord.id);
            }

            for(var x in selectedDocuments) {
                selectedDocuments[x].categoryId = categoryObj.objectId;
                selectedDocuments[x].save()
            }

            /* docsList.empty();
             docsList.loadItems();*/
        }

        this.filterDocumentsByCategory = function () {
            var selectedCategory = this.getSelectedCategory();

            docsList.filterByCategory(selectedCategory);
        }

    })

    var search = (function () {
        var _searchInTitlesOnly = null;
        var _query = null;
        function dialogSearch() {
            //self.closeAllDialogues();

            var bg=document.createElement('DIV');
            bg.className = options.dialogueBgClass;

            var dialogCon=document.createElement('DIV');
            dialogCon.className = options.dialogueConClass;
            dialogCon.addEventListener('touchend', function (e){
                e.stopPropagation();
                //if(e.currentTarget == e.target) self.closeAllDialogues();
            });

            var dialogue=document.createElement('DIV');
            dialogue.className = options.dialogueClass + ' ' + options.newDocDialogueClass;

            var form=document.createElement('FORM');


            var close=document.createElement('div');
            close.className = 'close-dialog-sign';

            close.addEventListener('click', closeAllDialogues);

            var dialogTitle=document.createElement('H3');
            dialogTitle.innerHTML = 'Search within ' + (typeof docsList.currentCategory == 'undefined' ? 'all categories' : '"' + docsList.currentCategory.name + '"');


            var inputCon=document.createElement('DIV');
            inputCon.className = 'input-group img-src';

            var documentName=document.createElement('INPUT');
            documentName.type='text';
            documentName.name='name';
            documentName.required='required';
            documentName.placeholder='Document name';
            documentName.addEventListener('keyup', function (e) {
                if(e.target.value != "")
                    form.querySelector('button[type="submit"]').disabled = false;
                else
                    form.querySelector('button[type="submit"]').disabled = 'disabled';
            });


            var clearInputValue = document.createElement('SPAN');
            clearInputValue.classList.add('input-group-addon');
            var circle = document.createElement('SPAN')
            circle.innerHTML = "<span>&#10005;</span>";
            clearInputValue.appendChild(circle);
            clearInputValue.addEventListener('touchend', function () {
                documentName.value = '';

            });

            var submitBtn=document.createElement('BUTTON');
            submitBtn.type='submit';
            submitBtn.className = 'button btn-blue';
            submitBtn.innerHTML = 'Search';

            submitBtn.addEventListener('touchend', function (e) {
                search.searchFormSubmit(documentName);
                e.preventDefault();
            })

            form.addEventListener('submit', function (e) {
                search.searchFormSubmit(documentName);
                e.preventDefault();
            });

            form.appendChild(dialogTitle);
            form.appendChild(close);
            inputCon.appendChild(documentName);
            inputCon.appendChild(clearInputValue);
            form.appendChild(inputCon);
            form.appendChild(submitBtn);

            dialogue.appendChild(form);
            dialogCon.appendChild(dialogue)
            document.body.appendChild(dialogCon);
            document.body.appendChild(bg);

            documentName.blur();

            views.dialogIsOpened();
        }

        function searchFormSubmit(queryInput) {
            search.doSearch(queryInput.value);
            topBar.toggleSearchForm(queryInput.value);

            queryInput.blur();

            closeAllDialogues();
        }

        function doSearch(query, titlesOnly) {
            _query = query;
            _searchInTitlesOnly = titlesOnly;
            editorDB('documents').getStorage((function (results) {

                var searchResults = [];
                for(var i in results) {
                    var item = results[i];
                    if(item.name.toLowerCase().indexOf(query.toLowerCase()) != -1) searchResults.push(item);
                }

                docsList.empty();

                if(searchResults.length == 0 && titlesOnly) {

                    docsList.docsListEl.innerHTML = '<div style="text-align: center">No results for "' + query + '" </div>';
                    docsList.updateUIonDocsListUpd();
                    return;
                }

                for(var i in searchResults){
                    var item = searchResults[i];
                    docsList.addItem(item);
                }

                docsList.updateUIonDocsListUpd();

                // highlight results in title
                for(var i in docsList.docsListItems){
                    var item = docsList.docsListItems[i];

                    var pattern = new RegExp("" + query + "", 'gi');
                    var highlighted = item.name.replace(pattern, '<span style="background: yellow;">' + query + '</span>');

                    item.setName(highlighted);
                }

                if(titlesOnly) return;

                editorDB('documents_html').getStorage((function (results) {

                    for(var i in results) {
                        var item = results[i];
                        var tempDiv = document.createElement('DIV');

                        //search
                        tempDiv.innerHTML = item.html;
                        var pattern = new RegExp("" + query + "", 'gi');
                        var currentItemMatches = [];
                        var result;
                        while (result = pattern.exec(tempDiv.innerText)) {
                            currentItemMatches.push({
                                startIndex:result.index,
                                endIndex:pattern.lastIndex,
                            });
                        }

                        if(i == results.length-1 && docsList.docsListItems.length == 0 && currentItemMatches.length == 0){
                            docsList.docsListEl.innerHTML = '<div style="text-align: center">No results for "' + query + '" </div>';
                            docsList.updateUIonDocsListUpd();
                        }

                        if(currentItemMatches.length == 0) continue;


                        //highlight
                        var textLength = tempDiv.innerText.length;
                        var textResults = [];
                        var match, i;
                        for(i = 0; match = currentItemMatches[i]; i++){
                            var beforeHighlighted = tempDiv.innerText.substring((match.startIndex - 10) != 0 ? match.startIndex - 10 : 0, match.startIndex)
                            var highlighted = tempDiv.innerText.substring(match.startIndex, match.endIndex)
                            var afterHighlighted = tempDiv.innerText.substring(match.endIndex, (match.endIndex + 10) != textLength ? match.endIndex + 10 : textLength)

                            var resultString = '... ' + beforeHighlighted + '<span style="background: yellow">' + highlighted + '</span>' + afterHighlighted;
                            textResults.push(resultString);
                        }

                        var docsListItem = docsList.docsListItems.filter(function(obj){
                            return obj.id == item.documentId;
                        })[0];

                        if(docsListItem != null) {
                            docsListItem.setIntro(textResults.join('...'))
                        } else {
                            docsList.addItem({
                                objectId: item.documentId,
                                introText: textResults.join('...'),
                            });

                            editorDB('documents').get(item.documentId, function (result) {

                                var docsListItem = docsList.docsListItems.filter(function(obj){
                                    return obj.id == result.objectId;
                                })[0];

                                docsListItem.name = result.name;
                                docsListItem.categoryId = result.categoryId;
                                docsListItem.created = result.created;
                                docsListItem.setName(result.name);

                                docsList.updateUIonDocsListUpd();
                            })
                        }
                    }

                }));


            }), null, null, null);
        }

        function getQuery() {
            if(_query != null) return _query;
            return false;
        }

        function reset() {
            _query = null;
        }

        function titlesOnly() {
            return _searchInTitlesOnly;
        }

        return {
            dialog: dialogSearch,
            searchFormSubmit: searchFormSubmit,
            doSearch: doSearch,
            getQuery: getQuery,
            titlesOnly: titlesOnly,
            reset: reset,
        }
    }());

    var editorDB = (function (objectsStoreName) {
        // IndexedDB
        var indexedDB = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.OIndexedDB || window.msIndexedDB;
        var dbVersion = 26;
        var baseName = "editorDB";
        var objectStores = ['documents', 'documents_html', 'categories'];
        var storeName = objectsStoreName;
        var shouldInit = true;

        function _logerr(err){
            if(_debug) console.log('%c editorDB: error', 'background:red;color:white', err);
        }

        function _openDb(f) {
            if(_debug) console.log('%c editorDB: _openDb', 'background:red;color:white');
            var request = indexedDB.open(baseName, dbVersion);
            request.onerror = _logerr;

            request.onupgradeneeded = function (e) {
                var db = e.currentTarget.result;
                if(_debug) console.log('%c editorDB: request.onupgradeneeded', 'background:blue;color:white');

                if(!db.objectStoreNames.contains('documents')) {
                    var documentsStore = db.createObjectStore("documents", {
                        keyPath: "objectId",
                        autoIncrement: true
                    });
                    documentsStore.createIndex("categoryId", "categoryId", {unique: false});
                }

                if(!db.objectStoreNames.contains('categories')) {
                    db.createObjectStore("categories", { keyPath: "objectId", autoIncrement:true });
                }

                if(!db.objectStoreNames.contains('documents_html')) {
                    var documentsHtmlStore = db.createObjectStore("documents_html", { keyPath: "objectId", autoIncrement:true });
                    documentsHtmlStore.createIndex("documentId", "documentId", { unique: true });
                }

                shouldInit = false;
                _openDb(f);

            }
            request.onsuccess = function () {
                f(request.result);
            }
        }

        function isOpened() {
            return isDbCreated;
        }

        function get(file, f){
            _openDb(function(db){
                var request = db.transaction([storeName], "readonly").objectStore(storeName).get(file);
                request.onerror = _logerr;
                request.onsuccess = function(){
                    f(request.result ? request.result : -1);
                }
            });
        }

        function getDocumentHTMLbyId(documentId, f){
            _openDb(function(db){
                var request = db.transaction([storeName], "readonly").objectStore(storeName).index('documentId').get(documentId);
                request.onerror = _logerr;
                request.onsuccess = function(){
                    f(request.result ? request.result : -1);
                }
            });
        }

        function getStorage(f, limit, index, indexValue){
            _openDb(function(db){
                var rows = [];
                var i = 0;
                var store = db.transaction([storeName], "readonly").objectStore(storeName);
                var keyRange = indexValue != null ? IDBKeyRange.only(indexValue) : null;
                if(_debug) console.log('index', index, indexValue)
                if(index != null) store = store.index(index);

                if(store.mozGetAll && !limit)
                    store.mozGetAll().onsuccess = function(e){
                        f(e.target.result);
                    };
                else
                    store.openCursor(keyRange).onsuccess = function(e) {
                        var cursor = e.target.result;
                        if((cursor && !limit) || (cursor && limit && i < limit)){
                            rows.push(cursor.value);
                            cursor.continue();
                        }
                        else {
                            f(rows);
                        }
                        i++;
                    };
            });
        }

        function countImages(f){
            _openDb(function(db){
                var request = db.transaction([storeName], "readonly").objectStore(storeName).count();
                request.onerror = _logerr;
                request.onsuccess = function(){
                    f(request.result ? request.result : -1);
                }
            });
        }

        function save(object, f){
            if(object.blob != null && object.blob instanceof Blob) {
                var fileReader = new FileReader();
                fileReader.onload = function(event) {
                    var arrayBuffer = event.target.result;
                    editorDB(storeName).save({alt:object.alt, blob:arrayBuffer, type:object.blob.type});
                };
                fileReader.readAsArrayBuffer(object.blob);
                return;
            }

            _openDb(function(db){
                var request = db.transaction([storeName], "readwrite").objectStore(storeName).put(object);
                request.onerror = _logerr;
                request.onsuccess = function(){
                    f(request.result);
                }
            });
        }

        function deleteObj(objId, index, indexValue, f){
            _openDb(function(db){
                var request = db.transaction([storeName], "readwrite").objectStore(storeName);

                var key = indexValue != null ? IDBKeyRange.only(indexValue) : objId;
                request.delete(key);

                request.onerror = _logerr;
                request.transaction.oncomplete = function(e) {
                    f()
                };

            });
        }

        return {
            save: save,
            getStorage: getStorage,
            get: get,
            remove: deleteObj,
            count: countImages,
            getDocumentHTMLbyId: getDocumentHTMLbyId,
        }

    })

    if(location.href.indexOf('deploy') != -1) {
        console.log('screenshot mode')
        editorDB = (function (objectsStoreName) {
            var language = 'en-GB';
            var storeName = objectsStoreName;
            function _openDb(f) {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', 'demoData.json');
                xhr.onload = function() {
                    if (xhr.status === 200) {
                       f(JSON.parse(xhr.responseText));
                    }
                    else {
                        alert('Request failed.  Returned status of ' + xhr.status);
                    }
                };
                xhr.send();
            }
            function get(doc, f){
                _openDb(function (demoData) {
                    if(demoData[navigator.language] != null) language = navigator.language;
                    var docHtml = demoData[language][objectsStoreName][doc];
                    f(docHtml != null ? docHtml : -1);
                })

            }

            function getStorage(f, limit, index, indexValue){
                _openDb(function (demoData) {
                    var rows = [];

                    if (demoData[navigator.language] != null) language = navigator.language;
                    for (var i in demoData[language][storeName]) {
                        var cursor = demoData[language][objectsStoreName][i];
                        var length = demoData[language][objectsStoreName].length;
                        rows.push(cursor);
                        if ((i == length - 1 && !limit) || (limit && i == limit)) {
                            f(rows);
                        }
                    }
                })
            }

            function save(f) {
                return true;
            }

            function deleteObj() {
                return true;
            }

            return {
                save: save,
                getStorage: getStorage,
                get: get,
                remove: deleteObj,
            }

        })
    }

    var touchEvent = {
        touchstartAction: null,
        touchmoveAction: null,
        touchendAction: null,
        currentTouchEvent: null,
        capture: function(e) {
            this.currentTouchEvent = e;
            var touch;
            if(e.type == 'touchstart') {
                touch = e.touches[0];
                if(touch == null) return;

                this.touchstartAction = touch;

                return;
            }

            if(e.type == 'touchmove') {
                touch = e.touches[0];
                if(touch == null) return;

                this.touchmoveAction = touch;

                return;
            }

            if(e.type == 'touchend') {
                touch = e.changedTouches[0];
                if(touch == null) return;

                this.touchendAction = touch;

                return;
            }

        },

        isTap: function() {
            if(_debug && this.currentTouchEvent.type != 'touchend') console.warn('isTap method should be called in touchend event handler');

            if(this.touchstartAction.identifier != this.touchendAction.identifier) return false;

            if(this.touchstartAction.clientX != this.touchendAction.clientX || this.touchstartAction.clientY != this.touchendAction.clientY) return false;

            return true;
        },

        hasTargetChanged: function() {
            if(_debug && this.currentTouchEvent.type != 'touchend') console.warn('hasTargetChanged method should be called in touchend event handler');

            if(this.touchstartAction.identifier != this.touchendAction.identifier) return;

            if(this.touchstartAction.target != this.touchendAction.target) return true;

            return false;
        },

    };

    var closeAllDialogues = function() {
        var elems=[].slice.call(document.getElementsByClassName(options.dialogueConClass)).concat([].slice.call(document.getElementsByClassName(options.dialogueBgClass)));
        for(var i=0;i<elems.length;i++) {
            elems[i].parentNode.removeChild(elems[i]);
        }
        views.dialogIsClosed();
    }

    var reposDialogs = function() {
        var elems=[].slice.call(document.getElementsByClassName(options.dialogueConClass)).concat([].slice.call(document.getElementsByClassName(options.dialogueBgClass)));
        for(var i=0;i<elems.length;i++) {
            var dialog = elems[i];

            var dialogRect = dialog.getBoundingClientRect();

            if(dialogRect.height <= window.innerHeight - 30) return;

            dialog.style.paddingTop = '110px';
            dialog.style.paddingBottom = '120px';
        }
    }


    init()

}())