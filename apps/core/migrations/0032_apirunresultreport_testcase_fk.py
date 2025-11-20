from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0031_add_apirunresultreport"),
    ]

    operations = [
        # Use SQL to convert the existing varchar `testcase_id` column into an integer FK `testcase_id`.
        # Steps:
        # 1. Add a temporary integer column `testcase_int`.
        # 2. Populate it by joining `core_testcase.testcase_id` -> `core_testcase.id`.
        # 3. Drop the old varchar column.
        # 4. Rename `testcase_int` -> `testcase_id` and add FK constraint.
        migrations.RunSQL(
            sql="""
            ALTER TABLE core_apirunresultreport ADD COLUMN testcase_int integer;
            UPDATE core_apirunresultreport r
            SET testcase_int = t.id
            FROM core_testcase t
            WHERE t.testcase_id = r.testcase_id AND r.testcase_id <> '';

            -- drop the old varchar column
            ALTER TABLE core_apirunresultreport DROP COLUMN testcase_id;

            -- rename temporary integer column to testcase_id
            ALTER TABLE core_apirunresultreport RENAME COLUMN testcase_int TO testcase_id;

            -- add foreign key constraint
            ALTER TABLE core_apirunresultreport
            ADD CONSTRAINT core_apirunresultreport_testcase_id_fk FOREIGN KEY (testcase_id) REFERENCES core_testcase (id) DEFERRABLE INITIALLY DEFERRED;
            """,
            reverse_sql="""
            -- reverse: remove fk, recreate varchar column and populate from testcases where possible
            ALTER TABLE core_apirunresultreport DROP CONSTRAINT IF EXISTS core_apirunresultreport_testcase_id_fk;
            ALTER TABLE core_apirunresultreport RENAME COLUMN testcase_id TO testcase_int;
            ALTER TABLE core_apirunresultreport ADD COLUMN testcase_id varchar(50);
            UPDATE core_apirunresultreport r
            SET testcase_id = t.testcase_id
            FROM core_testcase t
            WHERE t.id = r.testcase_int;
            ALTER TABLE core_apirunresultreport DROP COLUMN testcase_int;
            """,
        ),
    ]
