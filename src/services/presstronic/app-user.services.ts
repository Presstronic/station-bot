import { Repository } from 'typeorm';
import { AppUser } from '../../entity/app-user.entity';
import { Organization } from '../../entity/organization.entity'; // Assuming you may need to manage organizations
import { AppDataSource } from '../../data-source'; // Replace with your actual data source path

class AppUserService {
  private appUserRepository: Repository<AppUser>;

  constructor() {
    this.appUserRepository = AppDataSource.getRepository(AppUser);
  }

  // Fetch a user by their Discord ID
  public async getUserByDiscordId(discordId: string): Promise<AppUser | null> {
    return this.appUserRepository.findOne({ where: { discordOAuthToken: discordId } });
  }

  // Fetch a user by their RSI username
  public async getUserByRsiUsername(rsiUsername: string): Promise<AppUser | null> {
    return this.appUserRepository.findOne({ where: { rsiUsername } });
  }

  // Fetch a user by email address
  public async getUserByEmail(email: string): Promise<AppUser | null> {
    return this.appUserRepository.findOne({ where: { emailAddress: email } });
  }

  // Create or update an AppUser
  public async saveUser(userDetails: {
    discordOAuthToken: string;
    rsiUsername: string;
    discordUsername: string;
    emailAddress: string;
    firstname?: string;
    lastname?: string;
    primaryOrganization?: Organization;
  }): Promise<AppUser> {
    const existingUser = await this.getUserByRsiUsername(userDetails.rsiUsername);

    if (existingUser) {
      // Update existing user
      Object.assign(existingUser, userDetails);
      return this.appUserRepository.save(existingUser);
    } else {
      // Create a new user
      const newUser = this.appUserRepository.create(userDetails);
      return this.appUserRepository.save(newUser);
    }
  }

  // List all users
  public async getAllUsers(): Promise<AppUser[]> {
    return this.appUserRepository.find({ relations: ['primaryOrganization'] });
  }

  // Delete a user by ID
  public async deleteUserById(userId: number): Promise<void> {
    await this.appUserRepository.delete({ id: userId });
  }

  // Update an existing user's details
  public async updateUser(
    userId: number,
    updates: Partial<AppUser>
  ): Promise<AppUser | null> {
    const user = await this.appUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      return null;
    }

    Object.assign(user, updates);
    return this.appUserRepository.save(user);
  }

  // Check if a user exists by RSI username
  public async userExistsByRsiUsername(rsiUsername: string): Promise<boolean> {
    const count = await this.appUserRepository.count({ where: { rsiUsername } });
    return count > 0;
  }
}

export default new AppUserService();
