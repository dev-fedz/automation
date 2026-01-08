from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0035_testcase_is_automation_and_attachment"),
    ]

    operations = [
        # 0032_apirunresultreport_testcase_fk converted the DB column using raw SQL,
        # but did not update Django's migration state (it remained a CharField).
        # Align the state to the current model definition without touching the DB.
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.RemoveField(
                    model_name="apirunresultreport",
                    name="testcase_id",
                ),
                migrations.AddField(
                    model_name="apirunresultreport",
                    name="testcase",
                    field=models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="result_reports",
                        to="core.testcase",
                    ),
                ),
            ],
        ),
    ]
