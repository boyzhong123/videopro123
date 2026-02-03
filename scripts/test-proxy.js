#!/usr/bin/env node

/**
 * 代理服务器和 API 连接诊断工具
 * 用法: node scripts/test-proxy.js [port]
 * 示例: node scripts/test-proxy.js 3000
 */

const port = process.argv[2] || '3000';
const baseUrl = `http://localhost:${port}`;

console.log('==========================================');
console.log('🔍 代理服务器和 API 连接诊断工具');
console.log('==========================================\n');

async function testProxyHealth() {
  console.log('📋 测试 1/4: 检查代理服务器健康状态');
  console.log(`   URL: ${baseUrl}/api/proxy?url=${encodeURIComponent('https://httpbin.org/json')}`);
  
  try {
    const response = await fetch(`${baseUrl}/api/proxy?url=${encodeURIComponent('https://httpbin.org/json')}`);
    const data = await response.json();
    
    if (response.ok && data) {
      console.log('   ✅ 代理服务器正常工作\n');
      return true;
    } else {
      console.log(`   ❌ 代理服务器响应异常: ${response.status}\n`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ 代理服务器连接失败: ${error.message}`);
    console.log(`   💡 提示: 请确保开发服务器正在运行 (npm start 或 npm run dev)\n`);
    return false;
  }
}

async function testVolcesApiKey() {
  console.log('📋 测试 2/4: 检查火山引擎 API Key');
  
  // 尝试读取 .env 文件
  const fs = await import('fs');
  const path = await import('path');
  
  let apiKey = '';
  try {
    // 尝试多个可能的环境变量文件（按优先级）
    const envFiles = ['.env.local', '.env', '.env.production.local', '.env.development.local'];
    
    for (const envFile of envFiles) {
      const envPath = path.join(process.cwd(), envFile);
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const match = envContent.match(/VITE_DOUBAO_API_KEY=(.+)/);
        if (match) {
          apiKey = match[1].trim();
          console.log(`   📁 从 ${envFile} 读取配置`);
          break;
        }
      }
    }
  } catch (e) {
    // 忽略读取错误
  }
  
  if (!apiKey) {
    console.log('   ⚠️  未找到 VITE_DOUBAO_API_KEY');
    console.log('   💡 提示: 请在 .env 文件中配置火山引擎 API Key\n');
    return false;
  }
  
  console.log(`   📝 API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-8)}`);
  console.log('   ℹ️  注意: 此工具无法验证 Key 是否有效，需要实际调用 API 测试\n');
  return true;
}

async function testImageGenApi() {
  console.log('📋 测试 3/4: 测试图像生成 API 连接');
  console.log('   目标: https://ark.cn-beijing.volces.com/api/v3/images/generations');
  
  const testUrl = 'https://ark.cn-beijing.volces.com/api/v3/models';
  const proxyUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(testUrl)}`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(proxyUrl, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.ok) {
      console.log(`   ✅ 火山引擎 API 连接正常 (${response.status})\n`);
      return true;
    } else {
      const text = await response.text();
      console.log(`   ❌ 火山引擎 API 响应异常: ${response.status}`);
      console.log(`   响应: ${text.slice(0, 200)}\n`);
      return false;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('   ❌ 连接超时（10秒）');
      console.log('   💡 可能原因: 网络不稳定或需要代理访问境外服务\n');
    } else {
      console.log(`   ❌ 连接失败: ${error.message}\n`);
    }
    return false;
  }
}

async function testResponseStreaming() {
  console.log('📋 测试 4/4: 测试响应流完整性');
  console.log('   测试大响应体是否会被截断');
  
  const testUrl = 'https://httpbin.org/bytes/10000'; // 10KB 响应
  const proxyUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(testUrl)}`;
  
  try {
    const response = await fetch(proxyUrl);
    const buffer = await response.arrayBuffer();
    const size = buffer.byteLength;
    
    if (size >= 10000) {
      console.log(`   ✅ 响应流完整 (收到 ${size} 字节)\n`);
      return true;
    } else {
      console.log(`   ❌ 响应流不完整 (收到 ${size}/10000 字节)`);
      console.log('   💡 可能原因: 代理服务器配置问题或网络不稳定\n');
      return false;
    }
  } catch (error) {
    console.log(`   ❌ 测试失败: ${error.message}\n`);
    return false;
  }
}

async function runDiagnostics() {
  const results = {
    proxyHealth: false,
    apiKey: false,
    volcesApi: false,
    streaming: false
  };
  
  results.proxyHealth = await testProxyHealth();
  results.apiKey = await testVolcesApiKey();
  
  if (results.proxyHealth) {
    results.volcesApi = await testImageGenApi();
    results.streaming = await testResponseStreaming();
  }
  
  console.log('==========================================');
  console.log('📊 诊断结果汇总');
  console.log('==========================================');
  console.log(`代理服务器:     ${results.proxyHealth ? '✅ 正常' : '❌ 异常'}`);
  console.log(`API Key 配置:   ${results.apiKey ? '✅ 已配置' : '⚠️  未配置'}`);
  console.log(`火山引擎连接:   ${results.volcesApi ? '✅ 正常' : '❌ 异常'}`);
  console.log(`响应流完整性:   ${results.streaming ? '✅ 正常' : '❌ 异常'}`);
  console.log('==========================================\n');
  
  if (results.proxyHealth && results.apiKey && results.volcesApi && results.streaming) {
    console.log('🎉 所有测试通过！系统配置正常。\n');
  } else {
    console.log('⚠️  发现问题，请根据上述提示进行排查。\n');
    
    if (!results.proxyHealth) {
      console.log('🔧 解决方案 - 代理服务器问题:');
      console.log('   1. 确保服务器正在运行: npm start 或 npm run dev');
      console.log('   2. 检查端口是否正确（默认 3000）');
      console.log('   3. 检查防火墙设置\n');
    }
    
    if (!results.apiKey) {
      console.log('🔧 解决方案 - API Key 配置:');
      console.log('   1. 复制 .env.example 为 .env');
      console.log('   2. 在火山引擎控制台获取 API Key');
      console.log('   3. 填入 VITE_DOUBAO_API_KEY');
      console.log('   4. 重启开发服务器\n');
    }
    
    if (!results.volcesApi) {
      console.log('🔧 解决方案 - 火山引擎连接:');
      console.log('   1. 检查网络连接');
      console.log('   2. 境外访问可能需要代理');
      console.log('   3. 检查 API Key 权限和配额');
      console.log('   4. 尝试部署到境内服务器（如阿里云）\n');
    }
    
    if (!results.streaming) {
      console.log('🔧 解决方案 - 响应流被截断:');
      console.log('   1. 使用 npm start（自建代理）而非第三方代理');
      console.log('   2. 检查网络稳定性');
      console.log('   3. 增加超时时间');
      console.log('   4. 考虑部署到生产环境\n');
    }
  }
  
  console.log('📚 更多帮助: 查看 README.md 或 .env.example 中的说明\n');
}

// 运行诊断
runDiagnostics().catch(console.error);
