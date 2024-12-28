import 'reflect-metadata';
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Manufacturer } from './manufacturer.entity';
  
@Entity('vehicle')
export class Vehicle {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ type: 'int', nullable: false })
    uexCorpId: number;

    @Column({ type: 'boolean', default: false })
    canHaveCustomName: boolean;

    @ManyToOne(() => Manufacturer)
    manufacturer: Manufacturer;

    @Column({ type: 'varchar', length: 255, nullable: false })
    name: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
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

    @Column({ type: 'varchar', length: 50, nullable: true })
    padSize?: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    gameVersion?: string;

    @Column({ type: 'boolean', default: false })
    isDeleted: boolean = false  

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
        manufacturer: Manufacturer,
        name: string,
        cargoScuSize: number,
        crewSize: number,
        uexCorpDateCreated: Date,
        uexCorpDateModified: Date
    ) {
        this.uexCorpId = uexCorpId;
        this.canHaveCustomName = canHaveCustomName;
        this.manufacturer = manufacturer;
        this.name = name;
        this.cargoScuSize = cargoScuSize;
        this.crewSize = crewSize;
        this.uexCorpDateCreated = uexCorpDateCreated;
        this.uexCorpDateModified = uexCorpDateModified;
    }
}
