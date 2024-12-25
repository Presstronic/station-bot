import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Company } from './company.entity';
  
@Entity('vehicle')
export class Vehicle {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ nullable: false })
    uexCorpId: number;

    @Column({ default: false })
    canHaveCustomName: boolean;

    @ManyToOne(() => Company)
    company: Company;

    @Column({ length: 255, nullable: false })
    name: string;

    @Column({ length: 100, nullable: true })
    shortName?: string;

    @Column({ type: 'float', default: 0, nullable: false })
    cargoScuSize: number;

    @Column({ type: 'int', default: 0, nullable: false })
    crewSize: number;

    @Column({ type: 'text', nullable: true })
    rsiStoreURL?: string;

    @Column({ type: 'text', nullable: true })
    rsiBrochureUrl?: string;

    @Column({ type: 'text', nullable: true })
    rsiVideoUrl?: string;

    @Column({ length: 50, nullable: true })
    padSize?: string;

    @Column({ length: 50, nullable: true })
    gameVersion?: string;

    @Column({ type: 'timestamp', nullable: false })
    uexCorpDateCreated: Date;

    @Column({ type: 'timestamp', nullable: false })
    uexCorpDateModified: Date;

    @CreateDateColumn()
    dateCreated!: Date;

    @UpdateDateColumn()
    dateModified!: Date;

    constructor(
        uexCorpId: number,
        canHaveCustomName: boolean,
        company: Company,
        name: string,
        cargoScuSize: number,
        crewSize: number,
        uexCorpDateCreated: Date,
        uexCorpDateModified: Date
    ) {
        this.uexCorpId = uexCorpId;
        this.canHaveCustomName = canHaveCustomName;
        this.company = company;
        this.name = name;
        this.cargoScuSize = cargoScuSize;
        this.crewSize = crewSize;
        this.uexCorpDateCreated = uexCorpDateCreated;
        this.uexCorpDateModified = uexCorpDateModified;
    }
}
