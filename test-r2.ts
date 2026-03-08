// Temporary test file - delete after R2 is working
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const accountId = '9a3cff152d7787e328b44eacbaac3106';
const accessKeyId = '977a14a711643ccb364a081bd0f5a26d';
const secretAccessKey =
  '3dbef0f2859edec8524aaa3403dafb34176c1be75c2a8e4ebe64955d3b6a8f71';

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

async function testR2() {
  try {
    const command = new ListObjectsV2Command({
      Bucket: 'drawback',
    });
    const response = await client.send(command);
    console.log('✅ R2 Connection successful!');
    console.log(
      'Objects:',
      response.Contents?.map((obj) => obj.Key),
    );
  } catch (error) {
    console.error('❌ R2 Connection failed:', error);
  }
}

testR2();
