<?php

declare(strict_types=1);

const ARKOZ_API_ORIGIN = 'http://72.60.37.83';

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$allowedMethods = ['GET', 'POST', 'PATCH', 'OPTIONS'];
if (!in_array($method, $allowedMethods, true)) {
    http_response_code(405);
    header('Allow: GET, POST, PATCH, OPTIONS');
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Desteklenmeyen HTTP metodu']);
    exit;
}

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$requestUri = $_SERVER['REQUEST_URI'] ?? '/api/';
$path = parse_url($requestUri, PHP_URL_PATH);
if (!is_string($path) || strncmp($path, '/api/', 5) !== 0) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'API yolu bulunamadı']);
    exit;
}

$relativePath = substr($path, 5);
if (strpos(rawurldecode($relativePath), '..') !== false) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Geçersiz API yolu']);
    exit;
}

$target = ARKOZ_API_ORIGIN . '/api/' . ltrim($relativePath, '/');
$query = parse_url($requestUri, PHP_URL_QUERY);
if (is_string($query) && $query !== '') {
    $target .= '?' . $query;
}

$responseType = 'application/json; charset=utf-8';
$curl = curl_init($target);
curl_setopt_array($curl, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 180,
    CURLOPT_ENCODING => '',
    CURLOPT_HTTPHEADER => [
        'Accept: application/json',
        'Content-Type: ' . ($_SERVER['CONTENT_TYPE'] ?? 'application/json'),
        'X-Forwarded-Host: ' . ($_SERVER['HTTP_HOST'] ?? 'fanscore.pro'),
        'X-Forwarded-Proto: https',
    ],
    CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$responseType): int {
        if (stripos($line, 'Content-Type:') === 0) {
            $responseType = trim(substr($line, strlen('Content-Type:')));
        }
        return strlen($line);
    },
]);

if ($method === 'POST' || $method === 'PATCH') {
    curl_setopt($curl, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
}

$response = curl_exec($curl);
$status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$error = curl_error($curl);
curl_close($curl);

header('Content-Type: ' . $responseType);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if ($response === false || $status === 0) {
    http_response_code(502);
    echo json_encode([
        'error' => 'ARKOZ AI API bağlantısı kurulamadı',
        'detail' => $error,
    ]);
    exit;
}

http_response_code($status);
echo $response;
