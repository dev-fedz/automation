from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0049_scenario_comment_attachments"),
    ]

    operations = [
        migrations.RenameField(
            model_name="scenariocommentattachment",
            old_name="modified_at",
            new_name="updated_at",
        ),
    ]
