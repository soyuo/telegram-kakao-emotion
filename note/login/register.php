<?php
header('Content-Type: application/json; charset=utf-8');
function sha512Hash($data) {
    return substr(hash('sha512', $data), 0, 16);
}

function respond($success, $status, $data) {
    http_response_code($status);
    return json_encode(['success' => $success, 'status' => $status, 'data' => $data]);
}

function findDeviceUUID($email, $password) {
    $apiKeyPrefix = substr(sha512Hash($email . $password), 0, 17);
    $files = scandir('./storage');

    foreach ($files as $file) {
        if (strpos($file, $apiKeyPrefix) === 0) {
            $data = json_decode(file_get_contents('./storage/' . $file), true);
            if (isset($data['access_token'])) {
                echo respond(true, 200, 'already_kakaotalk_login');
                exit;
            }
            return $data['deviceUUID'] ?? null;
        }
    }

    return null;
}

function makeRequest($url, $postData, $headers) {
    $options = [
        'http' => [
            'header' => implode("\r\n", $headers ?? []),
            'method' => 'POST',
            'content' => json_encode($postData),
        ],
    ];
    $context = stream_context_create($options);
    $response = file_get_contents($url, false, $context);
    return json_decode($response, true);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo respond(false, -600, 'invalid_method');
    exit;
}
$input = file_get_contents('php://input');
$data = json_decode($input, true);

$email = $data['email'] ?? null;
$password = $data['password'] ?? null;

if ($email === null || $password === null) {
    echo respond(false, -1, 'Invalid input');
    exit;
}

$deviceUUID = findDeviceUUID($email, $password);

if ($deviceUUID === null) {
    echo respond(false, -100, 'please_login_first');
    exit;
}

$xVC = substr(sha512Hash('CAREY|KT/11.0.3 An/9 ko|GLENN|' . $email . '|PETER'), 0, 16);

$registerUrl = 'https://katalk.kakao.com/ios/account/passcodeLogin/registerDevice';
$registerPostData = [
    'email' => $email,
    'password' => $password,
    'device' => ['uuid' => $deviceUUID],
];
$headers = [
    'Accept-Language: ko',
    'A: ios/11.0.3/ko',
    'Accept-Encoding: gzip',
    'X-VC: ' . $xVC,
    'content-type: application/json; charset=UTF-8',
    'User-Agent: KT/11.0.3 An/9 ko',
];

$response = makeRequest($registerUrl, $registerPostData, $headers);

if ($response['status'] != 0) {
    echo respond(false, -400, 'invalid_data_status');
} else {
    $loginres = makeRequest('https://api.mogo.kr/v2/kakao-search/login/request', [
        'identity' => $email,
        'password' => $password,
        'type' => 0
    ]);
    echo json_encode($loginres);
}
?>