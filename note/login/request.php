<?php
header('Content-Type: application/json; charset=utf-8');
function generateDeviceUUID() {
    return implode('', array_map(function() {
        return dechex(mt_rand(0, 15));
    }, range(1, 40)));
}

function getOrCreateDeviceUUID($identity, $password) {
    $apiKeyPrefix = substr(sha512Hash($identity . $password), 0, 17);
    $files = scandir('./storage');
    
    foreach ($files as $file) {
        if (strpos($file, $apiKeyPrefix) === 0) {
            $data = json_decode(file_get_contents('./storage/' . $file), true);
            return $data['deviceUUID'] ?? generateDeviceUUID();
        }
    }
    
    $deviceUUID = generateDeviceUUID();
    $newData = [
        'email' => $identity,
        'deviceUUID' => $deviceUUID
    ];
    
    file_put_contents('./storage/' . $apiKeyPrefix . $deviceUUID . '.json', json_encode($newData));
    return $deviceUUID;
}

function sha512Hash($data) {
    return hash('sha512', $data);
}

function respond($success, $status, $data) {
    http_response_code($status);
    return json_encode(['success' => $success, 'status' => $status, 'data' => $data]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo respond(false, -600, 'invalid_method');
    exit;
}
$input = file_get_contents('php://input');
$data = json_decode($input, true);

$type = $data['type'] ?? null;
$identity = $data['identity'] ?? null;
$password = $data['password'] ?? null;

if ($type === null || $identity === null) {
    echo respond(false, -1, 'Invalid input');
    exit;
}

$deviceUUID = getOrCreateDeviceUUID($identity, $password);
$headers = [
    'Accept-Language: ko',
    'A: ios/11.0.3/ko',
    'Accept-Encoding: gzip',
    'content-type: application/x-www-form-urlencoded',
    'User-Agent: KT/11.0.3 An/9 ko',
];

$xVC = 'CAREY|KT/11.0.3 An/9 ko|GLENN|' . $identity . '|PETER';
$xVCHash = substr(sha512Hash($xVC), 0, 16);

if ($type == 0) {
    if ($password === null) {
        echo respond(false, -1, 'password_is_required');
        exit;
    }
    
    $files = scandir('./storage');
    $info = null;
    
    $apiKey = substr(sha512Hash($identity . $password), 0, 17);

    foreach ($files as $file) {
        if (strpos($file, $apiKey) === 0) {
            $info = json_decode(file_get_contents('./storage/' . $file), true);
            break;
        }
    }
    if($info['access_token']) {
        echo json_encode([
            'success' => true,
            'status' => 200,
            'data' => 'kakaotalk_login_success',
            'apiKey' => $apiKey
        ]);
        exit;
    }

    $url = 'https://katalk.kakao.com/ios/account/login.json';
    $postData = http_build_query([
        'password' => $password,
        'device_name' => 'kakaoSearch',
        'email' => $identity,
        'one_store' => false,
        'forced' => true,
        'permanent' => true,
        'device_uuid' => $deviceUUID,
    ]);

    $options = [
        'http' => [
            'header' => implode("\r\n", $headers) . "\r\nX-VC: " . $xVCHash,
            'method' => 'POST',
            'content' => $postData,
        ],
    ];
    $context = stream_context_create($options);
    $response = file_get_contents($url, false, $context);
    $data = json_decode($response, true);

    if ($data['status'] == 0) {
        $accessData = [
            'email' => $identity,
            'password' => $password,
            'deviceUUID' => $deviceUUID,
            'apiKey' => $apiKey,
            'access_token' => $data['access_token'],
            'refresh_token' => $data['refresh_token'],
            'user_id' => $data['userId'],
        ];
        file_put_contents('./storage/' . $apiKey . $deviceUUID . '.json', json_encode($accessData));
        echo json_encode([
            'success' => true,
            'status' => 200,
            'data' => 'kakaotalk_login_success',
            'apiKey' => $apiKey
        ]);
    } elseif ($data['status'] == -100) {
        echo respond(false, -100, 'need_kakaotalk_login');
    } else {
        echo respond(false, $data['status'], 'error');
    }
} elseif ($type == 1) {
    if ($password === null) {
        echo respond(false, -500, 'password_is_required');
        exit;
    }

    $apiKeyPrefix = substr(sha512Hash($identity . $password), 0, 17);
    $files = scandir('./storage');
    $found = false;
    $accessToken = null;

    foreach ($files as $file) {
        if (strpos($file, $apiKeyPrefix) === 0) {
            $found = true;
            $data = json_decode(file_get_contents('./storage/' . $file), true);
            $accessToken = $data['access_token'] ?? null;
            break;
        }
    }

    if ($found && $accessToken) {
        echo respond(true, 200, 'already_login_kakaotalk');
    } else {
        echo respond(false, -100, 'need_kakaotalk_login');
    }
} elseif ($type == 2) {
    $files = scandir('./storage');
    $found = false;
    foreach ($files as $file) {
        if (strpos($file, $identity) === 0) {
            $found = true;
            $data = json_decode(file_get_contents('./storage/' . $file), true);
            $accessToken = $data['access_token'] ?? null;
            break;
        }
    }
    if ($found) {
        echo respond(true, 200, 'exists_api_key');
    } else {
        echo respond(false, -100, 'invalid_api_key');
    }
} else {
    echo respond(false, -500, 'invaild_type');
}
?>
