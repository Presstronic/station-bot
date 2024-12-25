import { MigrationInterface, QueryRunner } from "typeorm";

export class StationBotInitialMigration1735110406677 implements MigrationInterface {
    name = 'StationBotInitialMigration1735110406677'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "vehicle_type" ("id" SERIAL NOT NULL, "name" character varying(100) NOT NULL, "friendlyName" character varying(255), "dateCreated" TIMESTAMP NOT NULL DEFAULT now(), "dateModified" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_465137c10960b54f82f1b145e43" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "manufacturer" ("id" SERIAL NOT NULL, "name" character varying(255) NOT NULL, "nickname" character varying(100), "industry" character varying(255), "isItemManufacturer" boolean NOT NULL DEFAULT false, "isVehicleManufacturer" boolean NOT NULL DEFAULT false, "uexCorpDateCreated" TIMESTAMP NOT NULL, "uexCorpDateModified" TIMESTAMP NOT NULL, "dateCreated" TIMESTAMP NOT NULL DEFAULT now(), "dateModified" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_81fc5abca8ed2f6edc79b375eeb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "vehicle" ("id" SERIAL NOT NULL, "uexCorpId" integer NOT NULL, "canHaveCustomName" boolean NOT NULL DEFAULT false, "name" character varying(255) NOT NULL, "shortName" character varying(100), "cargoScuSize" double precision NOT NULL DEFAULT '0', "crewSize" integer NOT NULL DEFAULT '0', "rsiStoreURL" text, "rsiBrochureUrl" text, "rsiVideoUrl" text, "padSize" character varying(50), "gameVersion" character varying(50), "uexCorpDateCreated" TIMESTAMP NOT NULL, "uexCorpDateModified" TIMESTAMP NOT NULL, "dateCreated" TIMESTAMP NOT NULL DEFAULT now(), "dateModified" TIMESTAMP NOT NULL DEFAULT now(), "manufacturerId" integer, CONSTRAINT "PK_187fa17ba39d367e5604b3d1ec9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "app_user" ("id" SERIAL NOT NULL, "discordOAuthToken" character varying NOT NULL, "rsiUsername" character varying(255) NOT NULL, "discordUsername" character varying(255) NOT NULL, "firstname" character varying(255), "lastname" character varying(255), "emailAddress" character varying NOT NULL, "rsiVerificationCode" character varying(100), "rsiVerificationDate" TIMESTAMP, "dateCreated" TIMESTAMP NOT NULL DEFAULT now(), "dateModified" TIMESTAMP NOT NULL DEFAULT now(), "primaryOrganizationId" integer, CONSTRAINT "UQ_641e55e2fee265cbb62b6c3b425" UNIQUE ("rsiUsername"), CONSTRAINT "UQ_ff98c94cbf681b0cfd48635feb9" UNIQUE ("emailAddress"), CONSTRAINT "PK_22a5c4a3d9b2fb8e4e73fc4ada1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "organization" ("id" SERIAL NOT NULL, "uexCorpId" integer NOT NULL, "rsi_slug" character varying NOT NULL, "name" character varying(255) NOT NULL, "rsiVerificationCode" character varying(100), "rsiVerificationDate" TIMESTAMP, "description" text, "logo" text, "dateCreated" TIMESTAMP NOT NULL DEFAULT now(), "dateModified" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9c5b8c1075f4a0d0c40da4a23ab" UNIQUE ("uexCorpId"), CONSTRAINT "UQ_40a117704ddc14bba8f328ddaf0" UNIQUE ("rsi_slug"), CONSTRAINT "PK_472c1f99a32def1b0abb219cd67" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "hangar" ("id" SERIAL NOT NULL, "dateAdded" TIMESTAMP NOT NULL DEFAULT now(), "dateModified" TIMESTAMP NOT NULL DEFAULT now(), "user_id" integer NOT NULL, "vehicle_id" integer NOT NULL, CONSTRAINT "PK_3ea29fb1d008b924cba8759e38b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "vehicle" ADD CONSTRAINT "FK_44e4dc3a8cdd9aa6c4db8fdd27c" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "app_user" ADD CONSTRAINT "FK_b9676aaa73abb9c30ab1f919d04" FOREIGN KEY ("primaryOrganizationId") REFERENCES "organization"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "hangar" ADD CONSTRAINT "FK_7a1bd8e33f5e0ea06da297cd4eb" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "hangar" ADD CONSTRAINT "FK_0db6227b6e25572d41f77dbb241" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hangar" DROP CONSTRAINT "FK_0db6227b6e25572d41f77dbb241"`);
        await queryRunner.query(`ALTER TABLE "hangar" DROP CONSTRAINT "FK_7a1bd8e33f5e0ea06da297cd4eb"`);
        await queryRunner.query(`ALTER TABLE "app_user" DROP CONSTRAINT "FK_b9676aaa73abb9c30ab1f919d04"`);
        await queryRunner.query(`ALTER TABLE "vehicle" DROP CONSTRAINT "FK_44e4dc3a8cdd9aa6c4db8fdd27c"`);
        await queryRunner.query(`DROP TABLE "hangar"`);
        await queryRunner.query(`DROP TABLE "organization"`);
        await queryRunner.query(`DROP TABLE "app_user"`);
        await queryRunner.query(`DROP TABLE "vehicle"`);
        await queryRunner.query(`DROP TABLE "manufacturer"`);
        await queryRunner.query(`DROP TABLE "vehicle_type"`);
    }

}
