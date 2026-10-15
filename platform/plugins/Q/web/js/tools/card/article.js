(function (Q, $, window, undefined) {
/**
 * @module Q-tools
 */
/**
 * Article / content card: headline + publication + key claim.
 *
 * @class Q/card/article
 * @constructor
 * @param {Object} [options]
 * @param {String} options.title
 * @param {String} [options.publication]
 * @param {String} [options.keyClaim]
 * @param {String} [options.url]
 * @param {String} [options.imageUrl]
 * @param {String} [options.date]
 * @param {Q.Event} [options.onRefresh]
 */
// Observed twice: the model puts the article's own page URL in imageUrl
// instead of url (imageUrl is meant for an actual image file). Real image
// URLs almost always end in a recognizable image extension; an article's
// own page essentially never does. Used below as a recovery heuristic,
// not just prompt wording, since LLM compliance here isn't guaranteed.
function _looksLikeImageUrl(url) {
    return /\.(jpe?g|png|gif|webp|avif|svg)(?:[?#]|$)/i.test(url || '');
}

Q.Tool.define("Q/card/article", function () {
    this.refresh();
},
{
    title: '', publication: '', keyClaim: '', url: '', imageUrl: '', date: '',
    onRefresh: new Q.Event()
},
{
    refresh: function () {
        var tool = this, s = tool.state;
        var url = s.url;
        var imageUrl = s.imageUrl;
        // No url given, but imageUrl doesn't look like an actual image --
        // most likely the article's page link landed in the wrong field.
        // Recover it as the headline's link instead of leaving the title
        // non-clickable with a guaranteed-broken image underneath it.
        if (!url && imageUrl && !_looksLikeImageUrl(imageUrl)) {
            url = imageUrl;
            imageUrl = '';
        }
        Q.Template.render('Q/card/article', {
            title: s.title, publication: s.publication, keyClaim: s.keyClaim,
            url: url, imageUrl: imageUrl, date: s.date,
            hasImage: !!imageUrl, hasClaim: !!s.keyClaim,
            hasMeta: !!(s.publication || s.date)
        }, function (err, html) {
            if (err) return;
            tool.element.innerHTML = html;
            Q.handle(s.onRefresh, tool);
        });
    }
});

Q.Template.set('Q/card/article',
    '<div class="Q_card Q_card_article">'
  + '  {{#if hasImage}}<img class="Q_card_article_image" src="{{imageUrl}}" alt="" onerror="this.style.display=\'none\'" />{{/if}}'
  + '  {{#if hasMeta}}<div class="Q_card_article_meta">'
  + '    {{#if publication}}<span class="Q_card_article_pub">{{publication}}</span>{{/if}}'
  + '    {{#if date}}<span class="Q_card_article_date">{{date}}</span>{{/if}}'
  + '  </div>{{/if}}'
  + '  <div class="Q_card_article_title">'
  + '    {{#if url}}<a href="{{url}}" target="_blank" rel="noopener">{{title}}</a>'
  + '    {{else}}{{title}}{{/if}}'
  + '  </div>'
  + '  {{#if hasClaim}}<div class="Q_card_article_claim">'
  + '    <span class="Q_card_article_claim_text">{{keyClaim}}</span>'
  + '    {{#if url}} <a class="Q_card_article_readmore" href="{{url}}" target="_blank" rel="noopener">Read more &rarr;</a>{{/if}}'
  + '  </div>{{/if}}'
  + '</div>'
);
})(Q, Q.jQuery, window);
