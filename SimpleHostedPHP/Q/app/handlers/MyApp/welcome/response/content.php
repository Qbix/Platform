<?php

function MyApp_welcome_response_content($params)
{
	// Do controller stuff here. Prepare variables
	$tabs = array("foo" => "bar");
	$description = "this is a description";
	Q_Response::addScript('js/pages/welcome.js');
	
	

	// set meta tags
	$communityId = Users::communityId();
	$communityUser = Users_User::fetch($communityId);
	$text = Q_Text::get($communityId.'/content');
	$title = Q::text($text['welcome']['Title'], array($communityId));
	$description = Q::text($text['welcome']['Description'], array($communityId));
	$communityIcon = Q_Uri::interpolateUrl($communityUser->icon.'/400.png');
	$url = Q_Uri::url($communityId.'/welcome');
	Q_Response::setMeta(array(
		array('name' => 'name', 'value' => 'title', 'content' => $title),
		array('name' => 'property', 'value' => 'og:title', 'content' => $title),
		array('name' => 'property', 'value' => 'twitter:title', 'content' => $title),
		array('name' => 'name', 'value' => 'description', 'content' => $description),
		array('name' => 'property', 'value' => 'og:description', 'content' => $description),
		array('name' => 'property', 'value' => 'twitter:description', 'content' => $description),
		array('name' => 'name', 'value' => 'image', 'content' => $communityIcon),
		array('name' => 'property', 'value' => 'og:image', 'content' => $communityIcon),
		array('name' => 'property', 'value' => 'twitter:image', 'content' => $communityIcon),
		array('name' => 'property', 'value' => 'og:url', 'content' => $url),
		array('name' => 'property', 'value' => 'twitter:url', 'content' => $url),
		array('name' => 'property', 'value' => 'twitter:card', 'content' => 'summary'),
		array('name' => 'property', 'value' => 'og:type', 'content' => 'website'),
	));
	if ($fbApps = Q_Config::get('Users', 'apps', 'facebook', array())) {
		$app = Q::app();
		$fbApp = isset($fbApps[$app]) ? $fbApps[$app] : reset($fbApps);
		if ($appId = $fbApp['appId']) {
			Q_Response::setMeta(array(
				'name' => 'property', 'value' => 'fb:app_id', 'content' => $appId
			));
		}
	}

	return Q::view('MyApp/content/welcome.php', @compact('tabs', 'description'));
}

