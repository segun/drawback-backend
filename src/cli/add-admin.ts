#!/usr/bin/env node
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { UserMode } from '../users/enums/user-mode.enum';
import AppDataSource from '../data-source';

async function addAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error('❌ Error: ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
    console.error('Example:');
    console.error('  ADMIN_EMAIL=admin@example.com');
    console.error('  ADMIN_PASSWORD=your-secure-password');
    process.exit(1);
  }

  console.log('🔌 Connecting to database...');
  let dataSource: DataSource;
  try {
    dataSource = await AppDataSource.initialize();
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    process.exit(1);
  }

  try {
    const userRepository = dataSource.getRepository(User);
    const normalizedEmail = adminEmail.toLowerCase();

    // Check if user already exists
    let user = await userRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (user) {
      console.log(`👤 User found: ${user.email}`);
      
      if (user.role === UserRole.ADMIN) {
        console.log('✅ User is already an admin. No changes needed.');
      } else {
        // Update existing user to admin
        user.role = UserRole.ADMIN;
        user.isActivated = true; // Ensure admin account is activated
        await userRepository.save(user);
        console.log('✅ User role updated to ADMIN');
      }
    } else {
      // Create new admin user
      console.log(`👤 User not found. Creating new admin user...`);
      
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      
      // Generate a simple display name from email (user can change it later)
      const displayNameBase = normalizedEmail.split('@')[0].slice(0, 27); // Leave room for uniqueness
      let displayName = displayNameBase;
      let suffix = 0;
      
      // Ensure display name is unique
      while (await userRepository.findOne({ where: { displayName } })) {
        suffix++;
        displayName = `${displayNameBase}${suffix}`;
      }

      user = userRepository.create({
        email: normalizedEmail,
        passwordHash,
        displayName,
        role: UserRole.ADMIN,
        isActivated: true, // Auto-activate admin accounts
        activationToken: null,
        activationTokenExpiry: null,
        mode: UserMode.PRIVATE,
        isBlocked: false,
      });

      await userRepository.save(user);
      console.log('✅ Admin user created successfully');
      console.log(`   Email: ${user.email}`);
      console.log(`   Display Name: ${user.displayName}`);
      console.log(`   Role: ${user.role}`);
    }

    console.log('\n✨ Done! You can now log in with admin credentials.');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

addAdmin();
