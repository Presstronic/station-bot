import { Repository } from 'typeorm';
import { Organization } from '../../entity/organization.entity';
import { AppUser } from '../../entity/app-user.entity';
import { AppDataSource } from '../../data-source'; // Replace with your actual data source path

class OrganizationService {
  private organizationRepository: Repository<Organization>;

  constructor() {
    this.organizationRepository = AppDataSource.getRepository(Organization);
  }

  // Fetch an organization by ID
  public async getOrganizationById(id: number): Promise<Organization | null> {
    return this.organizationRepository.findOne({
      where: { id },
      relations: ['appUsers'], // Include related appUsers
    });
  }

  // Fetch an organization by RSI slug
  public async getOrganizationByRsiSlug(rsiSlug: string): Promise<Organization | null> {
    return this.organizationRepository.findOne({ where: { rsi_slug: rsiSlug } });
  }

  // Fetch all organizations
  public async getAllOrganizations(): Promise<Organization[]> {
    return this.organizationRepository.find({ relations: ['appUsers'] });
  }

  // Create or update an organization
  public async saveOrganization(orgDetails: {
    uexCorpId: number;
    rsi_slug: string;
    name: string;
    rsiVerificationCode?: string;
    rsiVerificationDate?: Date;
    description?: string;
    logo?: string;
  }): Promise<Organization> {
    const existingOrg = await this.organizationRepository.findOne({
      where: { uexCorpId: orgDetails.uexCorpId },
    });

    if (existingOrg) {
      // Update existing organization
      Object.assign(existingOrg, orgDetails);
      return this.organizationRepository.save(existingOrg);
    } else {
      // Create a new organization
      const newOrg = this.organizationRepository.create(orgDetails);
      return this.organizationRepository.save(newOrg);
    }
  }

  // Delete an organization by ID
  public async deleteOrganizationById(id: number): Promise<boolean> {
    const deleteResult = await this.organizationRepository.delete({ id });
    return (deleteResult.affected ?? 0) > 0;
  }

  // Get all users in an organization
  public async getUsersInOrganization(organizationId: number): Promise<AppUser[]> {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
      relations: ['appUsers'],
    });

    return organization ? organization.appUsers : [];
  }

  // Add a user to an organization
  public async addUserToOrganization(
    organizationId: number,
    user: AppUser
  ): Promise<boolean> {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
      relations: ['appUsers'],
    });

    if (!organization) {
      throw new Error(`Organization with ID ${organizationId} not found.`);
    }

    if (organization.appUsers.find((existingUser) => existingUser.id === user.id)) {
      return false; // User is already in the organization
    }

    organization.appUsers.push(user);
    await this.organizationRepository.save(organization);
    return true;
  }

  // Remove a user from an organization
  public async removeUserFromOrganization(
    organizationId: number,
    userId: number
  ): Promise<boolean> {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
      relations: ['appUsers'],
    });

    if (!organization) {
      throw new Error(`Organization with ID ${organizationId} not found.`);
    }

    const initialUserCount = organization.appUsers.length;
    organization.appUsers = organization.appUsers.filter((user) => user.id !== userId);

    if (organization.appUsers.length === initialUserCount) {
      return false; // User not found in the organization
    }

    await this.organizationRepository.save(organization);
    return true;
  }
}

export default new OrganizationService();
