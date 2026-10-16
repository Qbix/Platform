<?php
/**
 * @module Q
 */
/**
 * @class Q_Video_Muse
 */
class Q_Video_Muse extends Q_Video {

	private $uploadEndPoint = "https://muse.ai/api/files/upload";
	private $deleteEndPoint = "https://muse.ai/api/files/delete/{{videoId}}";

	function __construct()	{
		$this->museApiKey = Q_Config::expect("Q", "video", "cloud", "upload", "muse", "key");
		$this->headers = array(
			"Key: $this->museApiKey"
		);

	}

	/**
	 * Create a video resource on the cloud provider
	 * @method doCreate
	 * @param {array} $params
	 * @throws {Q_Exception_MethodNotSupported|Q_Exception_Upload}
	 * @return {array} the response from the server, may contain errors
	 */
	function doCreate($params = array())
	{
		throw new Q_Exception_MissingFile(array('filename' => 'video'));
	}

	/**
	 * Upload file to muse.ai
	 * @method doUpload
	 * @param {string} $filename Filename of the file to upload
	 * @param {array} [$params] The parameters to send
	 * @throws {Q_Exception_MethodNotSupported|Q_Exception_Upload}
	 * @return {array}
	 */
	function doUpload($filename, $params = array())
	{

		$basename = basename($filename);
		$mimeType = finfo_file(finfo_open(FILEINFO_MIME_TYPE), $filename);
		$cFile = curl_file_create($filename, $mimeType, $basename);
		$fields = array(
			"file" => $cFile,
			"visibility" => "unlisted"
		);

		$ch = curl_init();
		curl_setopt($ch, CURLOPT_URL, $this->uploadEndPoint);
		curl_setopt($ch, CURLOPT_HTTPHEADER, array_merge($this->headers, ["Content-type: multipart/form-data"]));
		curl_setopt($ch, CURLOPT_POST,1);
		curl_setopt($ch, CURLOPT_POSTFIELDS, $fields);
		curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
		self::_secure($ch);
		$result = Q::json_decode(curl_exec($ch), true);
		curl_close($ch);

		if ($error = Q::ifset($result, "error", null)) {
			throw new Exception($error);
		}

		$result["videoId"] = $result["svid"];
		$result["videoUrl"] = Q::ifset($result, "mp4", preg_replace("/\/data$/", "/videos/video.mp4", $result["url"]));

		if (!$result["videoUrl"]) {
			return false;
		}

		return $result;
	}

	/**
	 * Delete video from the cloud provider
	 * @method doDelete
	 * @param {string} $videoId
	 * @throws {Q_Exception_MethodNotSupported|Q_Exception_Upload}
	 */
	function doDelete($videoId)
	{
		$ch = curl_init();
		curl_setopt($ch, CURLOPT_URL, Q::interpolate($this->deleteEndPoint, compact("videoId")));
		curl_setopt($ch, CURLOPT_HTTPHEADER, $this->headers);
		curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "DELETE");
		curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
		self::_secure($ch);
		curl_exec($ch);
		curl_close($ch);
	}

	/**
	 * Actions need to do when video processed
	 * @method processed
	 * @param {Streams_Stream} $stream Streams/video stream
	 */
	function processed($stream)
	{

	}

	/**
	 * Options every request to muse.ai gets (ro#1027). The Key header goes
	 * with each request, and curl resends custom headers to every redirect
	 * hop whatever its host, so redirects are not followed (the 3xx comes
	 * back); only https is spoken, and the certificate is verified, since
	 * that key is what an interceptor would want.
	 * @method _secure
	 * @static
	 * @private
	 * @param {resource|CurlHandle} $ch
	 */
	private static function _secure($ch)
	{
		curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
		curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
		curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
		if (defined('CURLOPT_PROTOCOLS_STR')) {
			curl_setopt($ch, CURLOPT_PROTOCOLS_STR, 'https');
		} else {
			curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
		}
	}

	function test($videoId, $sec) {
		$ch = curl_init();
		curl_setopt($ch, CURLOPT_URL, "https://muse.ai/api/files/set/71944d7430c461f0cd6e7fd10cee7eb72786352a3678fc7bc0ae3d410f72aece/cover?t=".$sec);
		curl_setopt($ch, CURLOPT_HTTPHEADER, $this->headers);
		curl_setopt($ch, CURLOPT_POST,1);
		curl_setopt($ch, CURLOPT_POSTFIELDS, [
			'svid' => $videoId,
			't' => $sec
		]);
		curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
		self::_secure($ch);

		try {
			$result = Q::json_decode(curl_exec($ch), true);
		} catch (Exception $exception) {
			return false;
		}

		curl_close($ch);
	}
};