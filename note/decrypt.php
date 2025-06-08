<?php
function preprocessKey($key) {
    $keyBytes = array_merge(array_values(unpack("C*", $key)), array_slice(array_values(unpack("C*", $key)), 0, 32 - strlen($key)));
    $computeKey = function($initial, $offset) use ($keyBytes) {
        $result = $initial;
        for ($i = 0; $i < 4; $i++) {
            $result = ($result << 8) | ($keyBytes[$i + $offset] & 0xFF);
        }
        return $result === 0 ? $initial : $result;
    };
    return [
        $computeKey(301989938, 0),
        $computeKey(623357073, 4),
        $computeKey(-2004086252, 8)
    ];
}

function processXor($key, $source) {
    list($key1, $key2, $key3) = preprocessKey($key);
    $result = '';
    for ($i = 0; $i < strlen($source); $i++) {
        $b = ord($source[$i]);
        $b13 = 0;
        $i16 = 0;
        $i17 = 1;

        for ($j = 0; $j < 8; $j++) {
            if (($key1 & 1) != 0) {
                $key1 = ((-2147483550 ^ $key1) >> 1) | 0x80000000;
                if (($key2 & 1) != 0) {
                    $key2 = (($key2 ^ 1073741856) >> 1) | -1073741824;
                    $i17 = 1;
                } else {
                    $key2 = ($key2 >> 1) & 1073741823;
                    $i17 = 0;
                }
            } else {
                $key1 = ($key1 >> 1) & 0x7FFFFFFF;
                if (($key3 & 1) != 0) {
                    $key3 = (($key3 ^ 268435458) >> 1) | -268435456;
                    $i16 = 1;
                } else {
                    $key3 = ($key3 >> 1) & 268435455;
                    $i16 = 0;
                }
            }
            $b13 = ($b13 << 1) | ($i17 ^ $i16);
        }
        $result .= chr($b ^ $b13);
    }
    return $result;
}

function emoticonDecrypt($source) {
    $key = "a271730728cbe141e47fd9d677e9006d";
    $output = '';
    $bufferIndex = 0;

    $chunk = substr($source, 0, 128);
    $chunk = processXor($key, $chunk);
    $output .= $chunk;

    $output .= substr($source, 128);

    return $output;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['file'])) {
    $uploadedFile = $_FILES['file']['tmp_name'];
    $fileContent = file_get_contents($uploadedFile);

    $decryptedContent = emoticonDecrypt($fileContent);

    header('Content-Type: image/webp');
    echo $decryptedContent;
} else {
    echo 'Please upload a .webp file.';
}
?>
