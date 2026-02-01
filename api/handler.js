const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// ログ出力用ヘルパー（環境に応じたログレベル制御）
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 環境変数からログレベルを取得（デフォルト: devはdebug、prodはwarn）
function getLogLevel() {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    return LOG_LEVELS[envLevel];
  }
  
  // 環境変数が設定されていない場合は、stageに基づいて決定
  const stage = process.env.STAGE || 'dev';
  return stage === 'prod' ? LOG_LEVELS.warn : LOG_LEVELS.debug;
}

const currentLogLevel = getLogLevel();

function log(level, message, data = {}) {
  const levelValue = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  
  // ログレベルが現在の設定より低い場合は出力しない
  if (levelValue < currentLogLevel) {
    return;
  }
  
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...data,
  };
  console.log(JSON.stringify(logEntry));
}

// シークレット取得（キャッシュ付き）
let configCache = null;

async function getConfig() {
  if (configCache) return configCache;
  
  try {
    const region = process.env.AWS_REGION || 'ap-northeast-1';
    if (!process.env.AWS_REGION) {
      log('warn', 'AWS_REGION not set, using default fallback', { 
        fallback: region 
      });
    }
    const secretsClient = new SecretsManagerClient({ region });
    const secret = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: process.env.AWS_SECRET_NAME })
    );
    
    configCache = JSON.parse(secret.SecretString);
    log('info', 'Config loaded from Secrets Manager', { 
      secretName: process.env.AWS_SECRET_NAME 
    });
    return configCache;
  } catch (error) {
    log('error', 'Failed to load config from Secrets Manager', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

// Cognito JWT検証（jwks-rsaを使用）
// userPoolId ごとにキャッシュ
const jwksClientCache = {};

function getJwksClient(userPoolId, region) {
  const cacheKey = `${userPoolId}-${region}`;
  if (!jwksClientCache[cacheKey]) {
    const jwksUri = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
    
    log('info', 'Initializing JWKS client', {
      userPoolId,
      region,
      jwksUri,
    });
    
    jwksClientCache[cacheKey] = jwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: 86400000, // 24時間
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }
  return jwksClientCache[cacheKey];
}

function getKey(userPoolId, region) {
  return (header, callback) => {
    const client = getJwksClient(userPoolId, region);
    log('info', 'Getting signing key from JWKS', {
      userPoolId,
      region,
      kid: header.kid,
    });
    client.getSigningKey(header.kid, (err, key) => {
      if (err) {
        log('error', 'Failed to get signing key from JWKS', {
          userPoolId,
          region,
          kid: header.kid,
          error: err.message,
          errorCode: err.code,
          errorStatus: err.statusCode,
        });
        callback(err);
        return;
      }
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    });
  };
}

async function verifyToken(token, userPoolId, region) {
  try {
    const decoded = await new Promise((resolve, reject) => {
      const jwtRegion = region || process.env.AWS_REGION || 'ap-northeast-1';
      if (!region && !process.env.AWS_REGION) {
        log('warn', 'AWS_REGION not set, using default fallback for JWT issuer', { 
          fallback: jwtRegion 
        });
      }
      jwt.verify(token, getKey(userPoolId, jwtRegion), {
        algorithms: ['RS256'],
        issuer: `https://cognito-idp.${jwtRegion}.amazonaws.com/${userPoolId}`,
      }, (err, decoded) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(decoded);
      });
    });
    
    log('info', 'JWT token verified', { 
      username: decoded['cognito:username'],
      groups: decoded['cognito:groups'] || []
    });
    
    return { valid: true, decoded };
  } catch (error) {
    log('warn', 'JWT token verification failed', { 
      error: error.message 
    });
    return { valid: false, error: error.message };
  }
}

// リクエストバリデーション
function validatePresignedUrlRequest(body) {
  const errors = [];
  
  if (!body.fileName || typeof body.fileName !== 'string') {
    errors.push('fileName is required and must be a string');
  }
  
  if (!body.fileType || typeof body.fileType !== 'string') {
    errors.push('fileType is required and must be a string');
  }
  
  if (!body.fileType.startsWith('image/')) {
    errors.push('fileType must be an image');
  }
  
  if (body.fileSize && body.fileSize > 10 * 1024 * 1024) {
    errors.push('fileSize must be less than 10MB');
  }
  
  return errors;
}

function validateSaveRequest(body) {
  const errors = [];
  
  if (!body.key || typeof body.key !== 'string') {
    errors.push('key is required and must be a string');
  }
  
  if (!body.publicUrl || typeof body.publicUrl !== 'string') {
    errors.push('publicUrl is required and must be a string');
  }
  
  if (!body.photoId || typeof body.photoId !== 'string') {
    errors.push('photoId is required and must be a string');
  }
  
  return errors;
}

function validateUpdateRequest(_body) {
  // 更新リクエストは任意のフィールドを更新できる
  // バリデーションは最小限に
  return [];
}

// S3からphotos.jsonを読み込む
async function loadPhotosFromS3(config) {
  try {
    const s3Client = new S3Client({ region: config.AWS_REGION });
    
    const getObjectCommand = new GetObjectCommand({
      Bucket: config.AWS_S3_SITE_BUCKET_NAME,
      Key: 'app/data/photos.json',
    });
    
    try {
      const response = await s3Client.send(getObjectCommand);
      const photosJson = await response.Body.transformToString();
      const photos = JSON.parse(photosJson);
      log('info', 'Photos loaded from S3', { count: photos.length });
      return photos;
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        log('info', 'photos.json not found in S3, returning empty array');
        return [];
      }
      throw error;
    }
  } catch (error) {
    log('error', 'Failed to load photos from S3', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

// S3にphotos.jsonを保存
async function savePhotosToS3(config, photos) {
  try {
    const s3Client = new S3Client({ region: config.AWS_REGION });
    
    const putObjectCommand = new PutObjectCommand({
      Bucket: config.AWS_S3_SITE_BUCKET_NAME,
      Key: 'app/data/photos.json',
      Body: JSON.stringify(photos, null, 2),
      ContentType: 'application/json',
    });
    
    await s3Client.send(putObjectCommand);
    log('info', 'Photos saved to S3', { count: photos.length });
  } catch (error) {
    log('error', 'Failed to save photos to S3', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

// Lambdaハンドラー
exports.handler = async (event) => {
  // API Gateway HTTP API (v2) のイベントを正規化（REST API 相当の形に揃える）
  const httpMethod = event.requestContext?.http?.method || event.httpMethod;
  const path = event.requestContext?.http?.path || event.rawPath || event.path || '';
  // CloudFront 経由では /api/photos で届く。ルーティング用に /api を除去
  const pathForRouting = path.startsWith('/api') ? path.slice(4) || '/' : path;
  const pathParameters = event.pathParameters || {};
  const headers = event.headers || {};
  const rawBody = event.body;
  const requestId = event.requestContext?.requestId || event.requestContext?.http?.requestId || 'unknown';

  log('info', 'Request received', {
    requestId,
    httpMethod,
    path,
    pathParameters,
  });
  
  // CORSヘッダー
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  };
  
  // OPTIONSリクエスト（CORSプリフライト）
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }
  
  // 認証が必要なエンドポイントのチェック（pathForRouting は /api 除去済み）
  const requiresAuth = ['POST', 'PUT', 'DELETE'].includes(httpMethod) && 
                       (pathForRouting.startsWith('/upload') || pathForRouting.startsWith('/photos'));
  
  let authResult = null;
  if (requiresAuth) {
    // Secrets Managerから設定を取得（COGNITO_USER_POOL_IDを含む）
    const config = await getConfig();
    
    if (!config.COGNITO_USER_POOL_ID) {
      log('error', 'COGNITO_USER_POOL_ID not found in Secrets Manager', { 
        secretName: process.env.AWS_SECRET_NAME 
      });
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: '認証設定が正しくありません' }),
      };
    }
    
    const authHeader = headers.Authorization || headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      log('warn', 'Missing or invalid Authorization header', { path });
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: '認証が必要です' }),
      };
    }
    
    const token = authHeader.substring(7);
    
    log('info', 'Verifying JWT token', {
      path,
      userPoolId: config.COGNITO_USER_POOL_ID,
      region: config.AWS_REGION,
      tokenLength: token.length,
      tokenPreview: token.substring(0, 50) + '...',
    });
    
    authResult = await verifyToken(token, config.COGNITO_USER_POOL_ID, config.AWS_REGION);
    
    if (!authResult.valid) {
      log('warn', 'JWT verification failed', { 
        path,
        userPoolId: config.COGNITO_USER_POOL_ID,
        region: config.AWS_REGION,
        error: authResult.error,
        jwksUri: `https://cognito-idp.${config.AWS_REGION}.amazonaws.com/${config.COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
      });
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: '認証に失敗しました' }),
      };
    }
    
    // 管理者グループのチェック（必要に応じて）
    const groups = authResult.decoded['cognito:groups'] || [];
    if (!groups.includes('admin')) {
      log('warn', 'User is not in admin group', { 
        username: authResult.decoded['cognito:username'],
        groups 
      });
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: '管理者権限が必要です' }),
      };
    }
  }
  
  // エンドポイント別の処理
  try {
    // GET /photos - 写真一覧取得（pathForRouting: /api/photos → /photos）
    if (httpMethod === 'GET' && pathForRouting === '/photos') {
      const config = await getConfig();
      const photos = await loadPhotosFromS3(config);
      
      return {
        statusCode: 200,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
        body: JSON.stringify(photos),
      };
    }
    
    // GET /photos/{id} - 写真詳細取得
    if (httpMethod === 'GET' && pathForRouting.startsWith('/photos/')) {
      const photoId = pathParameters?.id || pathForRouting.split('/').pop();
      
      if (!photoId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真IDが必要です' }),
        };
      }
      
      const config = await getConfig();
      const photos = await loadPhotosFromS3(config);
      const photo = photos.find(p => p.id === photoId);
      
      if (!photo) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真が見つかりません' }),
        };
      }
      
      return {
        statusCode: 200,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
        body: JSON.stringify(photo),
      };
    }
    
    // POST /upload/presigned-url - Presigned URL生成
    if (httpMethod === 'POST' && pathForRouting === '/upload/presigned-url') {
      let body;
      try {
        body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      } catch (_err) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid JSON in request body' }),
        };
      }
      
      const validationErrors = validatePresignedUrlRequest(body);
      if (validationErrors.length > 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: validationErrors.join(', ') }),
        };
      }
      
      const config = await getConfig();
      const s3Client = new S3Client({ region: config.AWS_REGION });
      
      const fileExtension = body.fileName.split('.').pop()?.toLowerCase() || 'jpg';
      const photoId = uuidv4();
      const safeFileName = `${photoId}.${fileExtension}`;
      const key = `uploads/${safeFileName}`;
      
      const command = new PutObjectCommand({
        Bucket: config.AWS_S3_BUCKET_NAME,
        Key: key,
        ContentType: body.fileType,
        CacheControl: 'max-age=31536000',
      });
      
      const presignedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 900, // 15分
      });
      
      const publicUrl = config.CLOUDFRONT_URL
        ? `${config.CLOUDFRONT_URL}/${key}`
        : `https://${config.AWS_S3_BUCKET_NAME}.s3.${config.AWS_REGION}.amazonaws.com/${key}`;
      
      log('info', 'Presigned URL generated', { photoId, key });
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presignedUrl,
          key,
          publicUrl,
          photoId,
        }),
      };
    }
    
    // POST /upload/save - 写真メタデータ保存
    if (httpMethod === 'POST' && pathForRouting === '/upload/save') {
      let body;
      try {
        body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      } catch (_err) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid JSON in request body' }),
        };
      }
      
      const validationErrors = validateSaveRequest(body);
      if (validationErrors.length > 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: validationErrors.join(', ') }),
        };
      }
      
      const config = await getConfig();
      const photos = await loadPhotosFromS3(config);
      
      const photoData = {
        id: body.photoId,
        src: body.publicUrl,
        title: body.title || { ja: '無題', en: 'Untitled' },
        description: body.description
          ? typeof body.description === 'string'
            ? { ja: [body.description], en: [] }
            : body.description
          : undefined,
        location: body.location || undefined,
        category: body.category || undefined,
        tags: body.tags && Array.isArray(body.tags) ? body.tags : [],
        exif: body.exif || undefined,
        published: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      photos.push(photoData);
      await savePhotosToS3(config, photos);
      
      log('info', 'Photo saved', { photoId: body.photoId });
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          photo: photoData,
        }),
      };
    }
    
    // PUT /photos/{id} - 写真メタデータ更新
    if (httpMethod === 'PUT' && pathForRouting.startsWith('/photos/')) {
      const photoId = pathParameters?.id || pathForRouting.split('/').pop();
      
      if (!photoId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真IDが必要です' }),
        };
      }
      
      let body;
      try {
        body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      } catch (_err) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Invalid JSON in request body' }),
        };
      }
      
      const validationErrors = validateUpdateRequest(body);
      if (validationErrors.length > 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: validationErrors.join(', ') }),
        };
      }
      
      const config = await getConfig();
      const photos = await loadPhotosFromS3(config);
      
      const photoIndex = photos.findIndex(p => p.id === photoId);
      if (photoIndex === -1) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真が見つかりません' }),
        };
      }
      
      const updatedPhoto = {
        ...photos[photoIndex],
        ...body,
        id: photoId, // IDは変更不可
        updatedAt: new Date().toISOString(),
      };
      
      photos[photoIndex] = updatedPhoto;
      await savePhotosToS3(config, photos);
      
      log('info', 'Photo updated', { photoId });
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          photo: updatedPhoto,
        }),
      };
    }
    
    // DELETE /photos/{id} - 写真削除
    if (httpMethod === 'DELETE' && pathForRouting.startsWith('/photos/')) {
      const photoId = pathParameters?.id || pathForRouting.split('/').pop();
      
      if (!photoId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真IDが必要です' }),
        };
      }
      
      const config = await getConfig();
      const photos = await loadPhotosFromS3(config);
      
      const photoIndex = photos.findIndex(p => p.id === photoId);
      if (photoIndex === -1) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: '写真が見つかりません' }),
        };
      }
      
      const photo = photos[photoIndex];
      
      // S3から画像を削除（srcがS3のURLの場合）
      if (photo.src && photo.src.startsWith('http')) {
        try {
          const s3Client = new S3Client({ region: config.AWS_REGION });
          
          // URLからキーを抽出
          let key;
          try {
            const url = new URL(photo.src);
            key = url.pathname.substring(1); // 先頭の/を削除
          } catch (_err) {
            log('warn', 'Failed to parse photo URL', { 
              photoId,
              photoSrc: photo.src 
            });
            throw new Error(`無効なURL形式: ${photo.src}`);
          }
          
          if (!key || !key.trim()) {
            throw new Error(`キーが抽出できませんでした: ${photo.src}`);
          }
          
          const deleteCommand = new DeleteObjectCommand({
            Bucket: config.AWS_S3_BUCKET_NAME,
            Key: key,
          });
          
          await s3Client.send(deleteCommand);
          log('info', 'Photo deleted from S3', { photoId, key });
        } catch (s3Error) {
          log('error', 'Failed to delete photo from S3', { 
            photoId,
            error: s3Error.message,
            stack: s3Error.stack 
          });
          // S3削除に失敗した場合は、エラーをスローしてphotos.jsonからの削除も中止
          throw new Error(`S3からの画像削除に失敗しました: ${s3Error.message}`);
        }
      }
      
      // photos.jsonから削除
      photos.splice(photoIndex, 1);
      await savePhotosToS3(config, photos);
      
      log('info', 'Photo deleted', { photoId });
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
        }),
      };
    }
    
    // 404 Not Found
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not Found' }),
    };
  } catch (error) {
    log('error', 'Lambda handler error', {
      requestId,
      httpMethod,
      path,
      error: error.message,
      stack: error.stack,
    });
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message || 'Internal Server Error',
        requestId,
      }),
    };
  }
};
