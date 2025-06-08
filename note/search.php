<?php
header('Content-Type: application/json; charset=utf-8');
function respond($success, $status, $data) {
    http_response_code($status);
    return json_encode(['success' => $success, 'status' => $status, 'data' => $data]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    echo respond(false, -600, 'invalid_method');
    exit;
}

$query = $_GET['query'] ?? '파댕이';

$info = null;

$info = json_decode(file_get_contents('./392djfklj920klsdaf3j290sdpofjwpaoj12-ri0294.json'), true);

$url = 'https://talk-pilsner.kakao.com/emoticon/item_store/search?type=' . urlencode($query) . '&referer=search';


$options = [
    'http' => [
        'header' => [
            'Authorization: ' . $info['access_token'] . '-' . $info['uuid'],
            'Talk-Agent: android/11.2.2',
            'Talk-Language: ko',
            'Content-Type: application/x-www-form-urlencoded',
            'User-Agent: okhttp/4.12.0'
        ],
        'method' => 'POST',
    ],
];

$context = stream_context_create($options);
$searchres = json_decode(file_get_contents($url, false, $context), true);

if (isset($searchres['reason']) && $searchres['reason'] === 'UNAUTHENTICATED') {
    $oauthUrl = 'https://katalk.kakao.com/android/account/oauth2_token.json';
    $postData = json_encode([
        'grant_type' => 'refresh_token',
        'access_token' => $info['access_token'],
        'refresh_token' => $info['refresh_token'],
    ]);

    $options = [
        'http' => [
            'header' => [
                'Content-Type: application/json; charset=UTF-8',
                'Authorization: ' . $info['access_token'] . '-' . $info['uuid'],
            ],
            'method' => 'POST',
            'content' => $postData,
        ],
    ];

    $context = stream_context_create($options);
    $oauth2 = json_decode(file_get_contents($oauthUrl, false, $context), true);
    
    $info['access_token'] = $oauth2['access_token'];
    $info['refresh_token'] = $oauth2['refresh_token'];
    file_put_contents('./392djfklj920klsdaf3j290sdpofjwpaoj12-ri0294.json', json_encode($info));

    $options = [
        'http' => [
            'header' => [
                'Authorization: ' . $info['access_token'] . '-' . $info['uuid'],
                'Talk-Agent: android/10.9.0',
                'Talk-Language: ko',
                'Content-Type: application/x-www-form-urlencoded',
                'User-Agent: okhttp/4.12.0'
            ],
            'method' => 'POST',
        ],
    ];

    $context = stream_context_create($options);
    $searchres = json_decode(file_get_contents($url, false, $context), true);
}


$statusCode = $searchres['status'];

echo respond($statusCode == 0, $statusCode, $searchres['emoticons'] ?? []);
?>
