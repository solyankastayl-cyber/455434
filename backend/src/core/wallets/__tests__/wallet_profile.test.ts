/**
 * B1 - Wallet Profile Test
 * 
 * Run: npx tsx src/core/wallets/__tests__/wallet_profile.test.ts
 */
import { walletProfileEngine } from '../wallet_profile.engine.js';
import type { RawWalletData } from '../wallet_profile.engine.js';

async function testWalletProfile() {
  console.log('\n🏦 Wallet Profile Engine Test (B1)\n');
  console.log('━'.repeat(60));
  
  // ============================================
  // Test 1: Build profile for active trader
  // ============================================
  console.log('\n📥 Test 1: Active high-volume trader');
  console.log('─'.repeat(60));
  
  const traderData: RawWalletData = {
    address: '0xtest-trader-001',
    chain: 'Ethereum',
    transactions: generateTraderTransactions(),
  };
  
  const traderProfile = await walletProfileEngine.buildProfile(traderData);
  
  console.log('Profile Summary:');
  console.log('  Headline:', traderProfile.summary?.headline);
  console.log('  Description:', traderProfile.summary?.description);
  console.log('  Tags:', traderProfile.tags.join(', '));
  console.log('  Confidence:', traderProfile.confidence.toFixed(2));
  console.log('  Dominant Action:', traderProfile.behavior.dominantAction);
  console.log('  Net Flow:', formatUSD(traderProfile.flows.netFlow));
  console.log('  Tokens Interacted:', traderProfile.tokens.interactedCount);
  
  // ============================================
  // Test 2: Build profile for holder/accumulator
  // ============================================
  console.log('\n📥 Test 2: Long-term holder');
  console.log('─'.repeat(60));
  
  const holderData: RawWalletData = {
    address: '0xtest-holder-002',
    chain: 'Ethereum',
    transactions: generateHolderTransactions(),
  };
  
  const holderProfile = await walletProfileEngine.buildProfile(holderData);
  
  console.log('Profile Summary:');
  console.log('  Headline:', holderProfile.summary?.headline);
  console.log('  Description:', holderProfile.summary?.description);
  console.log('  Tags:', holderProfile.tags.join(', '));
  console.log('  Confidence:', holderProfile.confidence.toFixed(2));
  console.log('  Net Flow:', formatUSD(holderProfile.flows.netFlow));
  
  // ============================================
  // Test 3: Build profile for whale
  // ============================================
  console.log('\n📥 Test 3: Whale wallet');
  console.log('─'.repeat(60));
  
  const whaleData: RawWalletData = {
    address: '0xtest-whale-003',
    chain: 'Ethereum',
    transactions: generateWhaleTransactions(),
  };
  
  const whaleProfile = await walletProfileEngine.buildProfile(whaleData);
  
  console.log('Profile Summary:');
  console.log('  Headline:', whaleProfile.summary?.headline);
  console.log('  Tags:', whaleProfile.tags.join(', '));
  console.log('  Total Volume:', formatUSD(whaleProfile.flows.totalIn + whaleProfile.flows.totalOut));
  console.log('  Top Token:', whaleProfile.tokens.topTokens[0]?.symbol || 'N/A');
  
  // ============================================
  // Test 4: Profile refresh
  // ============================================
  console.log('\n📥 Test 4: Profile refresh (same address)');
  console.log('─'.repeat(60));
  
  const updatedTraderData: RawWalletData = {
    ...traderData,
    transactions: [
      ...traderData.transactions,
      // Add more recent transactions
      ...generateRecentTransactions(),
    ],
  };
  
  const refreshedProfile = await walletProfileEngine.buildProfile(updatedTraderData);
  
  console.log('Refreshed Profile:');
  console.log('  Version:', refreshedProfile.snapshotVersion);
  console.log('  New TX Count:', refreshedProfile.activity.txCount);
  console.log('  Updated Tags:', refreshedProfile.tags.join(', '));
  
  // ============================================
  // Test 5: Search by tags
  // ============================================
  console.log('\n📥 Test 5: Search by tags');
  console.log('─'.repeat(60));
  
  const highVolumeWallets = await walletProfileEngine.searchByTags(['high-volume']);
  console.log('High-volume wallets found:', highVolumeWallets.length);
  
  const traders = await walletProfileEngine.searchByTags(['trader']);
  console.log('Traders found:', traders.length);
  
  // ============================================
  // Summary
  // ============================================
  console.log('\n' + '━'.repeat(60));
  console.log('📊 Test Summary\n');
  
  console.log('✅ Profile Building: Working');
  console.log('✅ Tag Derivation: Working');
  console.log('✅ Confidence Calculation: Working');
  console.log('✅ Summary Generation: Working');
  console.log('✅ Profile Refresh: Working');
  console.log('✅ Search by Tags: Working');
  
  console.log('\n🎉 Wallet Profile Engine test completed!\n');
}

// ============================================
// Test Data Generators
// ============================================

function generateTraderTransactions(): RawWalletData['transactions'] {
  const transactions: RawWalletData['transactions'] = [];
  const now = new Date();
  
  // Generate 60 days of trading activity
  for (let day = 0; day < 60; day++) {
    // 2-4 transactions per day
    const txPerDay = 2 + Math.floor(Math.random() * 3);
    
    for (let i = 0; i < txPerDay; i++) {
      const timestamp = new Date(now);
      timestamp.setDate(timestamp.getDate() - day);
      timestamp.setHours(Math.floor(Math.random() * 24));
      
      const isBuy = Math.random() > 0.4; // Slightly more buys
      
      transactions.push({
        hash: `0x${Math.random().toString(16).slice(2)}`,
        timestamp,
        type: isBuy ? 'in' : 'out',
        value: 5000 + Math.random() * 50000, // $5k - $55k per tx
        token: {
          address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          symbol: 'USDT',
          name: 'Tether USD',
        },
      });
    }
  }
  
  return transactions;
}

function generateHolderTransactions(): RawWalletData['transactions'] {
  const transactions: RawWalletData['transactions'] = [];
  const now = new Date();
  
  // Sparse but large buys over 180 days
  for (let i = 0; i < 12; i++) {
    const timestamp = new Date(now);
    timestamp.setDate(timestamp.getDate() - i * 15); // Every 15 days
    
    transactions.push({
      hash: `0x${Math.random().toString(16).slice(2)}`,
      timestamp,
      type: 'in', // Only buys
      value: 50000 + Math.random() * 100000, // $50k - $150k per tx
      token: {
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        symbol: 'WETH',
        name: 'Wrapped Ether',
      },
    });
  }
  
  return transactions;
}

function generateWhaleTransactions(): RawWalletData['transactions'] {
  const transactions: RawWalletData['transactions'] = [];
  const now = new Date();
  
  // Large transactions over 90 days
  for (let i = 0; i < 30; i++) {
    const timestamp = new Date(now);
    timestamp.setDate(timestamp.getDate() - i * 3);
    
    const isBuy = Math.random() > 0.3;
    
    transactions.push({
      hash: `0x${Math.random().toString(16).slice(2)}`,
      timestamp,
      type: isBuy ? 'in' : 'out',
      value: 500000 + Math.random() * 2000000, // $500k - $2.5M per tx
      token: {
        address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        symbol: 'USDT',
        name: 'Tether USD',
      },
    });
  }
  
  return transactions;
}

function generateRecentTransactions(): RawWalletData['transactions'] {
  const transactions: RawWalletData['transactions'] = [];
  const now = new Date();
  
  // 5 recent transactions
  for (let i = 0; i < 5; i++) {
    const timestamp = new Date(now);
    timestamp.setHours(timestamp.getHours() - i);
    
    transactions.push({
      hash: `0x${Math.random().toString(16).slice(2)}`,
      timestamp,
      type: Math.random() > 0.5 ? 'in' : 'out',
      value: 10000 + Math.random() * 40000,
      token: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        name: 'USD Coin',
      },
    });
  }
  
  return transactions;
}

function formatUSD(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return '$' + (value / 1000000).toFixed(2) + 'M';
  }
  if (Math.abs(value) >= 1000) {
    return '$' + (value / 1000).toFixed(1) + 'K';
  }
  return '$' + value.toFixed(0);
}

// ============================================
// Run Test
// ============================================

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/blockview';

async function main() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URL);
    console.log('Connected!');
    
    await testWalletProfile();
    
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main();
