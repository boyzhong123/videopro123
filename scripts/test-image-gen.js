#!/usr/bin/env node

/**
 * 直接测试火山引擎 Seedream 图像生成 API
 * 用法: node scripts/test-image-gen.js
 */

import fs from 'fs';
import path from 'path';

console.log('==========================================');
console.log('🖼️  火山引擎 Seedream 图像生成 API 测试');
console.log('==========================================\n');

// 读取 API Key
let apiKey = '';
try {
  const envFiles = ['.env.local', '.env'];
  for (const envFile of envFiles) {
    const envPath = path.join(process.cwd(), envFile);
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const match = envContent.match(/VITE_DOUBAO_API_KEY=(.+)/);
      if (match) {
        apiKey = match[1].trim();
        console.log(`📁 从 ${envFile} 读取 API Key`);
        console.log(`📝 API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-8)}\n`);
        break;
      }
    }
  }
} catch (e) {
  console.error('❌ 读取环境变量失败:', e.message);
  process.exit(1);
}

if (!apiKey) {
  console.error('❌ 未找到 VITE_DOUBAO_API_KEY');
  console.error('💡 请在 .env 或 .env.local 中配置');
  process.exit(1);
}

// 测试 API 调用
async function testImageGeneration() {
  const endpoint = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
  
  console.log('📋 测试信息:');
  console.log(`   端点: ${endpoint}`);
  console.log(`   模型: doubao-seedream-4-5-251128`);
  console.log(`   提示词: "a beautiful sunset over mountains"\n`);
  
  const requestBody = {
    model: "doubao-seedream-4-5-251128",
    prompt: "a beautiful sunset over mountains, photorealistic, 8k",
    size: "2K",
    response_format: "url",
    watermark: true
  };
  
  console.log('🚀 发送请求...\n');
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    console.log(`📥 响应状态: ${response.status} ${response.statusText}\n`);
    
    const responseText = await response.text();
    
    if (response.ok) {
      console.log('✅ 请求成功！\n');
      
      try {
        const data = JSON.parse(responseText);
        console.log('📊 响应数据:');
        console.log(JSON.stringify(data, null, 2));
        
        if (data.data?.[0]?.url) {
          console.log('\n🎨 生成的图片 URL:');
          console.log(data.data[0].url);
          console.log('\n✅ Seedream 图像生成服务工作正常！');
        }
      } catch (e) {
        console.log('⚠️  响应不是有效的 JSON，原始响应:');
        console.log(responseText.slice(0, 500));
      }
    } else {
      console.log('❌ 请求失败\n');
      console.log('📄 错误响应:');
      console.log(responseText);
      console.log('\n');
      
      // 解析错误信息
      try {
        const error = JSON.parse(responseText);
        const errorCode = error.error?.code;
        const errorMessage = error.error?.message;
        
        console.log('🔍 错误分析:');
        console.log(`   错误代码: ${errorCode}`);
        console.log(`   错误信息: ${errorMessage}\n`);
        
        if (errorCode === 'AuthenticationError') {
          console.log('💡 解决方案 - 认证错误 (401):');
          console.log('   1. 检查 API Key 是否正确');
          console.log('   2. 确认已在火山引擎控制台开通 Seedream 图像生成服务');
          console.log('   3. 检查服务是否在 "default" 项目下');
          console.log('   4. 访问控制台: https://console.volcengine.com/');
          console.log('      → 搜索 "Seedream" 或 "图像生成"');
          console.log('      → 点击 "立即开通" 或 "申请试用"');
          console.log('   5. 确认账户余额充足\n');
        } else if (errorCode === 'QuotaExceeded') {
          console.log('💡 解决方案 - 配额不足:');
          console.log('   1. 检查火山引擎控制台账户余额');
          console.log('   2. 查看 API 调用配额限制');
          console.log('   3. 如有需要，充值或升级套餐\n');
        } else if (errorCode === 'RateLimitExceeded') {
          console.log('💡 解决方案 - 触发限流:');
          console.log('   1. 等待一段时间后重试');
          console.log('   2. 检查是否频繁调用');
          console.log('   3. 考虑升级配额\n');
        }
      } catch (e) {
        // 无法解析错误信息
      }
    }
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('❌ 请求超时（30秒）');
      console.log('💡 可能原因: 网络不稳定或服务响应慢\n');
    } else {
      console.log('❌ 请求失败:', error.message, '\n');
    }
  }
}

console.log('==========================================\n');
testImageGeneration().catch(console.error);
