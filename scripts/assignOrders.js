// scripts/assignOrders.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Channels } from '../model/channels.js';
import { SubChannels } from '../model/subChannels.js';

dotenv.config();

async function assignOrders() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    
    // ==================== CHANNELS ====================
    console.log('\n🔧 Assigning orders to Channels...');
    
    // Get all channels sorted by creation date
    const channels = await Channels.find({}).sort({ createdAt: 1 });
    
    console.log(`Found ${channels.length} channels`);
    
    // Assign orders based on creation date
    for (let i = 0; i < channels.length; i++) {
      await Channels.findByIdAndUpdate(
        channels[i]._id,
        { order: i },
        { new: true }
      );
      console.log(`✓ Channel "${channels[i].name}" → order: ${i}`);
    }
    
    // ==================== SUBCHANNELS ====================
    console.log('\n🔧 Assigning orders to SubChannels...');
    
    // Get all channels to process their subchannels
    const allChannels = await Channels.find({});
    
    for (const channel of allChannels) {
      console.log(`\nProcessing subchannels for channel: ${channel.name}`);
      
      // Get subchannels for this channel sorted by creation date
      const subchannels = await SubChannels.find({ 
        channel: channel._id 
      }).sort({ createdAt: 1 });
      
      console.log(`Found ${subchannels.length} subchannels`);
      
      // Assign orders based on creation date
      for (let i = 0; i < subchannels.length; i++) {
        await SubChannels.findByIdAndUpdate(
          subchannels[i]._id,
          { order: i },
          { new: true }
        );
        console.log(`  ✓ SubChannel "${subchannels[i].name}" → order: ${i}`);
      }
    }
    
    console.log('\n🎉 Order assignment completed successfully!');
    
    // Show final results
    const finalChannels = await Channels.find({}).sort({ order: 1 });
    console.log('\n📋 Final Channel Order:');
    finalChannels.forEach(channel => {
      console.log(`  ${channel.order}. ${channel.name}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  }
}

// Run the script
assignOrders();